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
 * Claude Code splits one API message into several assistant messages that
 * share its id and carry one block each, so a complete message's blocks start
 * at the index after those already received for that id.
 */

import { TurnState } from "../TurnState.js";
import { type AgentEvent, type TokenUsage, inSubagent } from "../events.js";
import { normalizeClaudeRateLimitEvent } from "../usage-limits.js";
import type { SDKMessage } from "./sdk-message.js";

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

/** What a failed run's `subtype` means, when it carries no message of its own. */
const RESULT_ERRORS: Record<string, string> = {
  error_during_execution: "The run failed while executing.",
  error_max_turns: "The run stopped: it reached the maximum number of turns.",
  error_max_budget_usd: "The run stopped: it reached its budget.",
  error_max_structured_output_retries: "The run stopped: its structured output kept failing.",
};

/** Error text for a failed `result` message, or undefined when it succeeded. */
export function claudeResultError(message: SDKMessage): string | undefined {
  const subtype = String(message.subtype ?? "");
  const failed = message.is_error === true || subtype.startsWith("error");
  if (!failed) return undefined;
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((error): error is string => typeof error === "string" && !!error)
    : [];
  if (errors.length) return errors.join("\n");
  if (typeof message.result === "string" && message.result) return message.result;
  return RESULT_ERRORS[subtype] ?? (subtype || "The Claude run failed.");
}

/** What the user can do about an API error the SDK reports, by its kind. */
const API_ERROR_HINTS: Record<string, string> = {
  authentication_failed:
    "Claude is not logged in, or the login has expired. Run `claude auth login` in a terminal, then send the message again.",
  billing_error: "The Claude account has a billing problem.",
  rate_limit: "The Claude usage limit has been reached.",
};

/**
 * The error of a message the SDK made up to report a failed API call (it
 * carries `error`), or undefined for a real assistant message.
 */
function apiError(message: SDKMessage): string | undefined {
  if (typeof message.error !== "string") return undefined;
  const content = message.message?.content;
  const text = Array.isArray(content)
    ? content
        .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
        .join("")
        .trim()
    : String(content ?? "").trim();
  const hint = API_ERROR_HINTS[message.error];
  return [hint, text].filter(Boolean).join("\n") || `Claude API error: ${message.error}`;
}

/** A system message worth showing: retries, compaction, a local command's output. */
function systemNotice(message: SDKMessage): AgentEvent[] {
  const key = String(message.uuid ?? message.subtype);
  switch (message.subtype) {
    case "api_retry": {
      const status = message.error_status ?? message.error ?? "error";
      const delay = Math.round(Number(message.retry_delay_ms ?? 0) / 1000);
      // One notice per turn, updated by each retry.
      return [
        {
          type: "notice",
          key: "api-retry",
          level: "info",
          text: `The API request failed (${status}); retry ${message.attempt}/${message.max_retries} in ${delay}s.`,
        },
      ];
    }
    case "compact_boundary": {
      const metadata = record(message.compact_metadata);
      const how = metadata.trigger === "auto" ? "automatically" : "on request";
      return [{ type: "notice", key, level: "info", text: `Context compacted ${how}.` }];
    }
    case "local_command_output":
      return typeof message.content === "string" && message.content
        ? [{ type: "notice", key, level: "info", text: message.content }]
        : [];
    default:
      return [];
  }
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
 * Dedup and block state for one agent: the main agent, or one subagent. Block
 * ids and message ids are only unique within an agent, so each gets its own.
 */
class ClaudeScope {
  turn = new TurnState();
  activeMessage = "";
  private serial = 0;
  /** Blocks of the complete messages received so far, by message id. */
  private completeBlocks = new Map<string, string[]>();
  private streamedTools = new Map<string, { id: string; name: string; json: string }>();

  streamEvent(event: Record<string, unknown>): AgentEvent[] {
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
        const tool = { id: String(block.id), name: String(block.name), json: "" };
        this.streamedTools.set(key, tool);
        // Show the call as soon as the agent starts writing it.
        return this.turn.toolInputDelta(tool.id, tool.name, "");
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
      if (tool && delta.type === "input_json_delta") {
        const chunk = String(delta.partial_json ?? "");
        tool.json += chunk;
        return this.turn.toolInputDelta(tool.id, tool.name, chunk);
      }
      return [];
    }
    if (event.type === "content_block_stop") {
      const tool = this.streamedTools.get(key);
      if (!tool) return [];
      this.streamedTools.delete(key);
      try {
        return this.turn.toolCall(tool.id, tool.name, JSON.parse(tool.json || "{}"));
      } catch {
        return this.turn.toolCallInvalid(
          tool.id,
          tool.name,
          tool.json,
          "Incomplete tool arguments",
        );
      }
    }
    return [];
  }

  /** Blocks of a complete assistant or user message. */
  content(message: SDKMessage): AgentEvent[] {
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
        const offset = this.contentOffset(messageId, nested.content);
        for (const [position, value] of nested.content.entries()) {
          const block = record(value);
          const key = `${messageId}:${offset + position}`;
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

  /**
   * Content index of the first block of a complete message: 0 when it repeats
   * the blocks already received for its id, otherwise the next free index.
   */
  private contentOffset(messageId: string, content: unknown[]): number {
    const seen = this.completeBlocks.get(messageId) ?? [];
    const blocks = content.map(blockSignature);
    const repeat = blocks.every((signature, index) => seen[index] === signature);
    const offset = repeat ? 0 : seen.length;
    blocks.forEach((signature, index) => {
      seen[offset + index] = signature;
    });
    this.completeBlocks.set(messageId, seen);
    return offset;
  }
}

/** What tells two copies of a content block apart from two different blocks. */
function blockSignature(value: unknown): string {
  const block = record(value);
  if (block.type === "tool_use") return `tool_use:${String(block.id)}`;
  if (block.type === "text") return `text:${String(block.text ?? "")}`;
  if (block.type === "thinking") return `thinking:${String(block.thinking ?? "")}`;
  return String(block.type);
}

/**
 * Stateful: one adapter per provider session. Subagent traffic (messages with
 * `parent_tool_use_id`) is kept, in its own scope, and tagged with the tool
 * call that started the subagent. State that only matters within a turn is
 * dropped when the turn completes.
 */
export class ClaudeEventAdapter {
  private root = new ClaudeScope();
  private subagents = new Map<string, ClaudeScope>();
  private modelResolved = false;
  /** A failed API call this turn; it, not the result's bare text, explains the failure. */
  private turnApiError: string | undefined;

  accept(message: SDKMessage): AgentEvent[] {
    const parent =
      typeof message.parent_tool_use_id === "string" && message.parent_tool_use_id
        ? message.parent_tool_use_id
        : undefined;
    if (parent) return inSubagent(this.scoped(this.subagentScope(parent), message), parent);

    switch (message.type) {
      case "system":
        if (message.subtype === "init" && typeof message.session_id === "string")
          return [{ type: "session.started", sessionId: message.session_id }];
        return systemNotice(message);
      case "assistant": {
        // The SDK's report of a failed API call is no answer; the turn ends with it.
        const error = apiError(message);
        if (error) {
          this.turnApiError = error;
          return [];
        }
        return [...this.resolveModel(message), ...this.scoped(this.root, message)];
      }
      case "rate_limit_event": {
        const limits = normalizeClaudeRateLimitEvent("claude", message);
        return limits ? [{ type: "rate-limit", limits }] : [];
      }
      case "result": {
        const error = this.turnApiError ?? claudeResultError(message);
        this.root = new ClaudeScope();
        this.subagents.clear();
        this.turnApiError = undefined;
        return [
          {
            type: "turn.completed",
            error,
            usage: usage(message),
            contextWindow: contextWindow(message),
          },
        ];
      }
      default:
        return this.scoped(this.root, message);
    }
  }

  /** Stream and content messages, which every agent sends the same way. */
  private scoped(scope: ClaudeScope, message: SDKMessage): AgentEvent[] {
    if (message.type === "stream_event") return scope.streamEvent(record(message.event));
    if (message.type === "assistant" || message.type === "user") return scope.content(message);
    return [];
  }

  private subagentScope(parent: string): ClaudeScope {
    let scope = this.subagents.get(parent);
    if (!scope) {
      scope = new ClaudeScope();
      this.subagents.set(parent, scope);
    }
    return scope;
  }

  private resolveModel(message: SDKMessage): AgentEvent[] {
    const model = message.message?.model;
    if (this.modelResolved || !model || model === "<synthetic>") return [];
    this.modelResolved = true;
    return [{ type: "model.resolved", model }];
  }
}
