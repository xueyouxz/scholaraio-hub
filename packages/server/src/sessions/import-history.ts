import { randomUUID } from "node:crypto";
import type { SessionMessage } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import type { AgentEvent } from "../agent/events.js";
import { TurnState } from "../agent/turnState.js";
import { UIChunkWriter } from "../agent/uiChunks.js";
import { ClaudeEventAdapter } from "../sdk/providers/claude-events.js";
import type { SDKMessage } from "../sdk/types.js";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** One line of an uploaded transcript: a user turn boundary, or agent events. */
type Entry = { kind: "user"; text: string } | { kind: "agent"; events: AgentEvent[] };

/** Claude Code transcript lines, via the same adapter the live provider uses. */
function claudeEntries(lines: Record<string, unknown>[]): Entry[] {
  const adapter = new ClaudeEventAdapter();
  const entries: Entry[] = [];
  for (const line of lines) {
    if (!["user", "assistant"].includes(String(line.type)) || !line.message) continue;
    const message = line as unknown as SDKMessage;
    const body = message.message?.content;
    const text =
      typeof body === "string"
        ? body
        : Array.isArray(body)
          ? body
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
          : "";
    if (message.type === "user" && text) {
      entries.push({ kind: "user", text });
    } else {
      entries.push({ kind: "agent", events: adapter.accept(message) });
    }
  }
  return entries;
}

/** Codex rollout `response_item` lines. */
function codexEntries(lines: Record<string, unknown>[]): Entry[] {
  let turn = new TurnState();
  const entries: Entry[] = [];
  for (const line of lines) {
    if (line.type !== "response_item") continue;
    const payload = object(line.payload);
    if (payload.type === "message") {
      const text = Array.isArray(payload.content)
        ? payload.content.map((part) => object(part).text ?? "").join("\n")
        : String(payload.content ?? "");
      if (payload.role === "user") {
        turn = new TurnState();
        entries.push({ kind: "user", text });
      } else {
        const blockId = typeof payload.id === "string" ? payload.id : randomUUID();
        entries.push({ kind: "agent", events: turn.textSnapshot("text", blockId, text) });
      }
    } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      let input: unknown = payload.input ?? payload.arguments;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          input = { text: input };
        }
      }
      entries.push({
        kind: "agent",
        events: turn.toolCall(String(payload.call_id), String(payload.name), input),
      });
    } else if (
      payload.type === "function_call_output" ||
      payload.type === "custom_tool_call_output"
    ) {
      entries.push({
        kind: "agent",
        events: turn.toolResult(String(payload.call_id), String(payload.output), false),
      });
    }
  }
  return entries;
}

async function assemble(chunks: UIMessageChunk[]): Promise<SessionMessage | undefined> {
  let last: SessionMessage | undefined;
  for await (const message of readUIMessageStream<SessionMessage>({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "start", messageId: randomUUID() });
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    }),
    terminateOnError: true,
  }))
    last = message;
  return last;
}

/** Explicit uploaded histories only. Never enumerates provider home directories. */
export async function importHistory(
  content: string,
  provider: "claude" | "codex",
): Promise<SessionMessage[]> {
  const lines = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return object(JSON.parse(line));
      } catch {
        throw new SyntaxError(`历史文件第 ${index + 1} 行不是有效 JSON。`);
      }
    });

  const result: SessionMessage[] = [];
  let chunks: UIMessageChunk[] = [];
  let writer = new UIChunkWriter((chunk) => chunks.push(chunk));
  const flush = async () => {
    if (!chunks.length) return;
    writer.close();
    const assistant = await assemble(chunks);
    if (assistant) result.push(assistant);
    chunks = [];
    writer = new UIChunkWriter((chunk) => chunks.push(chunk));
  };

  for (const entry of provider === "claude" ? claudeEntries(lines) : codexEntries(lines)) {
    if (entry.kind === "user") {
      await flush();
      result.push({ id: randomUUID(), role: "user", parts: [{ type: "text", text: entry.text }] });
    } else {
      for (const event of entry.events) writer.write(event);
    }
  }
  await flush();

  if (!result.length)
    throw new SyntaxError("没有找到可导入的会话消息，请检查文件与 AI 工具是否对应。");
  return result;
}
