/**
 * Claude Agent SDK messages → AgentEvent.
 *
 * The Agent SDK reports a turn twice: token-level `stream_event`s (when
 * `includePartialMessages` is on) and then complete `assistant` / `user`
 * messages. Both are fed through TurnState so each piece of text, each tool
 * call and each tool result reaches consumers exactly once.
 *
 * Block identity follows the Anthropic API: `<message id>:<content index>`,
 * which is the same for a streamed block and its copy in the final message.
 */

import type { AgentEvent, TokenUsage } from "../../agent/events.js";
import { TurnState } from "../../agent/turnState.js";
import { normalizeClaudeRateLimitEvent } from "../../services/ProviderUsageLimitService.js";
import type { SDKMessage } from "../types.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const SUPPORTED_FILE_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/** Only inline data or remote URLs; never a path on this machine. */
function fileSource(block: Record<string, unknown>): { mediaType: string; url: string } | null {
  const source = record(block.source);
  const mediaType = String(source.media_type ?? block.mediaType ?? "");
  if (!SUPPORTED_FILE_TYPES.test(mediaType)) return null;
  const url =
    source.type === "base64" && typeof source.data === "string"
      ? `data:${mediaType};base64,${source.data}`
      : source.url;
  if (typeof url !== "string" || !/^(https?:\/\/|data:)/.test(url)) return null;
  return { mediaType, url };
}

/** Error text for a failed `result` message, or undefined when it succeeded. */
export function claudeResultError(message: SDKMessage): string | undefined {
  const failed = message.is_error === true || String(message.subtype ?? "").startsWith("error");
  if (!failed) return undefined;
  return String(message.error ?? message.result ?? message.errors ?? message.subtype);
}

/** Largest context window across `modelUsage` entries (keys may carry "[1m]"). */
function contextWindow(message: SDKMessage): number | undefined {
  let largest: number | undefined;
  for (const entry of Object.values(record(message.modelUsage))) {
    const window = record(entry).contextWindow;
    if (typeof window === "number" && window > 0) largest = Math.max(largest ?? 0, window);
  }
  return largest;
}

function usage(message: SDKMessage): TokenUsage | undefined {
  const raw = record(message.usage);
  if (typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") {
    return undefined;
  }
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cachedInputTokens:
      typeof raw.cache_read_input_tokens === "number" ? raw.cache_read_input_tokens : undefined,
  };
}

/**
 * Stateful: one adapter per provider session. State that only matters within a
 * turn is dropped when the turn completes.
 */
export class ClaudeEventAdapter {
  private turn = new TurnState();
  private activeMessage = "";
  private serial = 0;
  private streamedTools = new Map<string, { id: string; name: string; json: string }>();
  private modelResolved = false;

  accept(message: SDKMessage): AgentEvent[] {
    // Subagent traffic is summarized by its parent tool's result.
    if (message.parent_tool_use_id) return [];

    switch (message.type) {
      case "system":
        return message.subtype === "init" && typeof message.session_id === "string"
          ? [{ type: "session.started", sessionId: message.session_id }]
          : [];
      case "stream_event":
        return this.streamEvent(record(message.event));
      case "assistant":
        return [...this.resolveModel(message), ...this.content(message)];
      case "user":
        return this.content(message);
      case "rate_limit_event": {
        const limits = normalizeClaudeRateLimitEvent("claude", message);
        return limits ? [{ type: "rate-limit", limits }] : [];
      }
      case "result":
        return this.complete({
          type: "turn.completed",
          error: claudeResultError(message),
          usage: usage(message),
          contextWindow: contextWindow(message),
        });
      default:
        return [];
    }
  }

  private complete(event: Extract<AgentEvent, { type: "turn.completed" }>): AgentEvent[] {
    this.turn = new TurnState();
    this.streamedTools.clear();
    this.activeMessage = "";
    return [event];
  }

  private resolveModel(message: SDKMessage): AgentEvent[] {
    const model = message.message?.model;
    if (this.modelResolved || !model || model === "<synthetic>") return [];
    this.modelResolved = true;
    return [{ type: "model.resolved", model }];
  }

  private streamEvent(event: Record<string, unknown>): AgentEvent[] {
    if (event.type === "message_start") {
      this.activeMessage = String(record(event.message).id ?? `native-${++this.serial}`);
      return [];
    }
    const key = `${this.activeMessage}:${event.index ?? 0}`;
    if (event.type === "content_block_start") {
      const block = record(event.content_block);
      if (block.type === "text") return this.turn.textDelta("text", key, String(block.text ?? ""));
      if (block.type === "thinking") {
        return this.turn.textDelta("reasoning", key, String(block.thinking ?? ""));
      }
      if (block.type === "tool_use") {
        this.streamedTools.set(key, { id: String(block.id), name: String(block.name), json: "" });
      }
      return [];
    }
    if (event.type === "content_block_delta") {
      const delta = record(event.delta);
      if (delta.type === "text_delta")
        return this.turn.textDelta("text", key, String(delta.text ?? ""));
      if (delta.type === "thinking_delta") {
        return this.turn.textDelta("reasoning", key, String(delta.thinking ?? ""));
      }
      const tool = this.streamedTools.get(key);
      if (tool && delta.type === "input_json_delta") tool.json += String(delta.partial_json ?? "");
      return [];
    }
    if (event.type === "content_block_stop") {
      const tool = this.streamedTools.get(key);
      if (!tool) return [];
      this.streamedTools.delete(key);
      try {
        return this.turn.toolCall(tool.id, tool.name, JSON.parse(tool.json || "{}"));
      } catch {
        return this.turn.toolCallInvalid(tool.id, tool.name, tool.json, "工具参数不完整");
      }
    }
    return [];
  }

  /** Blocks of a complete assistant or user message. */
  private content(message: SDKMessage): AgentEvent[] {
    const nested = record(message.message);
    const events: AgentEvent[] = [];

    if (message.type === "assistant") {
      const nativeId = String(
        nested.id ?? message.uuid ?? (this.activeMessage || `native-${++this.serial}`),
      );
      if (typeof nested.content === "string") {
        events.push(...this.turn.textSnapshot("text", nativeId, nested.content));
      } else if (Array.isArray(nested.content)) {
        const messageId = String(nested.id ?? (this.activeMessage || nativeId));
        for (const [index, value] of nested.content.entries()) {
          const block = record(value);
          const key = `${messageId}:${index}`;
          if (block.type === "text") {
            events.push(...this.turn.textSnapshot("text", key, String(block.text ?? "")));
          } else if (block.type === "thinking") {
            events.push(...this.turn.textSnapshot("reasoning", key, String(block.thinking ?? "")));
          } else if (block.type === "image" || block.type === "document") {
            const file = fileSource(block);
            if (file) events.push(...this.turn.file(key, file.mediaType, file.url));
          } else if (block.type === "tool_use") {
            events.push(...this.turn.toolCall(String(block.id), String(block.name), block.input));
          }
        }
      }
    }

    if (Array.isArray(nested.content)) {
      // Claude Code attaches structured detail to the message, not the block;
      // it is unambiguous only when the message carries a single result.
      const results = nested.content.filter((value) => record(value).type === "tool_result");
      const detail =
        results.length === 1 ? (message.tool_use_result ?? message.toolUseResult) : undefined;
      for (const value of results) {
        const block = record(value);
        const callId = String(block.tool_use_id);
        events.push(
          ...this.turn.toolResult(callId, block.content, block.is_error === true, detail),
        );
        if (Array.isArray(block.content)) {
          for (const [index, part] of block.content.entries()) {
            const file = fileSource(record(part));
            if (file)
              events.push(...this.turn.file(`${callId}:${index}`, file.mediaType, file.url));
          }
        }
      }
    }
    return events;
  }
}
