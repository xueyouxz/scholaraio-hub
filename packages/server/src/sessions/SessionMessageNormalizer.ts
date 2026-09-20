import type { UIMessageChunk } from "ai";
import type { SDKMessage } from "../sdk/types.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Converts provider events once, before persistence and UI transport. No HTML. */
export class SessionMessageNormalizer {
  private activeMessage = "";
  private serial = 0;
  private blocks = new Map<string, { kind: "text" | "reasoning"; value: string; ended: boolean }>();
  private tools = new Set<string>();
  private outputs = new Set<string>();
  private files = new Set<string>();
  private streamedTools = new Map<string, { id: string; name: string; json: string }>();
  constructor(private emit: (chunk: UIMessageChunk) => void) {}

  private text(key: string, kind: "text" | "reasoning", value: string, delta: boolean) {
    let state = this.blocks.get(key);
    if (!state) {
      state = { kind, value: "", ended: false };
      this.blocks.set(key, state);
      this.emit({ type: `${kind}-start`, id: key });
    }
    const addition = delta
      ? value
      : value.startsWith(state.value)
        ? value.slice(state.value.length)
        : "";
    if (addition) {
      this.emit({ type: `${kind}-delta`, id: key, delta: addition });
      state.value += addition;
    }
  }

  private tool(id: string, name: string, input: unknown) {
    if (this.tools.has(id)) return;
    this.emit({
      type: "tool-input-available",
      toolCallId: id,
      toolName: name,
      input,
      dynamic: true,
    });
    this.tools.add(id);
  }

  private file(key: string, block: Record<string, unknown>): void {
    if (this.files.has(key)) return;
    const source = record(block.source);
    const mediaType = String(source.media_type ?? block.mediaType ?? "");
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(mediaType)) return;
    const url =
      source.type === "base64" && typeof source.data === "string"
        ? `data:${mediaType};base64,${source.data}`
        : source.url;
    if (typeof url !== "string" || !/^(https?:\/\/|data:)/.test(url)) return;
    this.emit({ type: "file", mediaType, url });
    this.files.add(key);
  }

  accept(message: SDKMessage): void {
    // Nested agent traffic is summarized by its parent tool result.
    if (message.parent_tool_use_id) return;
    if (message.type === "stream_event") {
      const event = record(message.event);
      if (event.type === "message_start") {
        this.activeMessage = String(record(event.message).id ?? `native-${++this.serial}`);
      }
      const key = `${this.activeMessage}:${event.index ?? 0}`;
      const block = record(event.content_block);
      if (event.type === "content_block_start") {
        if (block.type === "text") this.text(key, "text", String(block.text ?? ""), true);
        if (block.type === "thinking")
          this.text(key, "reasoning", String(block.thinking ?? ""), true);
        if (block.type === "tool_use")
          this.streamedTools.set(key, { id: String(block.id), name: String(block.name), json: "" });
      }
      if (event.type === "content_block_delta") {
        const delta = record(event.delta);
        if (delta.type === "text_delta") this.text(key, "text", String(delta.text ?? ""), true);
        if (delta.type === "thinking_delta")
          this.text(key, "reasoning", String(delta.thinking ?? ""), true);
        const tool = this.streamedTools.get(key);
        if (tool && delta.type === "input_json_delta")
          tool.json += String(delta.partial_json ?? "");
      }
      if (event.type === "content_block_stop") {
        const tool = this.streamedTools.get(key);
        if (tool) {
          try {
            this.tool(tool.id, tool.name, JSON.parse(tool.json || "{}"));
          } catch {
            this.emit({
              type: "tool-input-error",
              toolCallId: tool.id,
              toolName: tool.name,
              input: tool.json,
              dynamic: true,
              errorText: "工具参数不完整",
            });
          }
        }
      }
      return;
    }
    if (message.type === "text_delta") {
      this.text(String(message.uuid), "text", String(message.delta ?? ""), true);
      return;
    }
    const nested = record(message.message);
    if (message.type === "assistant") {
      const nativeId = String(
        nested.id ?? message.uuid ?? (this.activeMessage || `native-${++this.serial}`),
      );
      const contents =
        typeof nested.content === "string"
          ? [{ type: "text", text: nested.content }]
          : nested.content;
      if (!Array.isArray(contents)) return;
      // Snapshot messages may arrive both at item/start and item/complete in Codex.
      for (const [index, value] of contents.entries()) {
        const block = record(value);
        const key =
          typeof nested.content === "string"
            ? nativeId
            : `${nested.id ?? (this.activeMessage || nativeId)}:${index}`;
        if (block.type === "text") this.text(key, "text", String(block.text ?? ""), false);
        if (block.type === "thinking")
          this.text(key, "reasoning", String(block.thinking ?? ""), false);
        if (block.type === "image" || block.type === "document") this.file(key, block);
        if (block.type === "tool_use" && !this.tools.has(String(block.id)))
          this.tool(String(block.id), String(block.name), block.input);
      }
    }
    if (Array.isArray(nested.content)) {
      for (const value of nested.content) {
        const block = record(value);
        if (block.type !== "tool_result") continue;
        const id = String(block.tool_use_id);
        if (this.outputs.has(id)) continue;
        if (!this.tools.has(id)) this.tool(id, "Tool", {});
        this.emit(
          block.is_error
            ? {
                type: "tool-output-error",
                toolCallId: id,
                errorText: String(block.content),
                dynamic: true,
              }
            : {
                type: "tool-output-available",
                toolCallId: id,
                output: block.content,
                dynamic: true,
              },
        );
        if (Array.isArray(block.content)) {
          for (const [index, value] of block.content.entries())
            this.file(`${id}:${index}`, record(value));
        }
        this.outputs.add(id);
      }
    }
  }

  finish(): void {
    for (const [id, block] of this.blocks) {
      if (!block.ended) {
        this.emit({ type: `${block.kind}-end`, id });
        block.ended = true;
      }
    }
  }
}
