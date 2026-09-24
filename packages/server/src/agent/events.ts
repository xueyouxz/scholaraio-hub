/**
 * The unified agent message: what any provider tells the hub about a turn.
 *
 * Layering (the part borrowed from Yep Anywhere):
 *
 *   provider transport ──▶ provider adapter ──▶ AgentEvent ──▶ consumers
 *   (Agent SDK, codex     (claude-events.ts,    (this file)   (Process lifecycle,
 *    app-server)           codex-events.ts)                    UI chunks, telemetry)
 *
 * Yep Anywhere's shared model is a loosely typed, Claude-shaped `Message`, so
 * every non-Claude provider is flattened into Anthropic content blocks and every
 * consumer re-parses them with defensive casts. Here the shared model is a
 * closed discriminated union instead:
 *
 * - Provider vocabulary stops at the adapter. Nothing downstream knows what a
 *   `stream_event`, a `content_block_delta` or an `item/completed` is.
 * - Text arrives as deltas only. Providers that resend whole snapshots (Claude's
 *   final assistant message, Codex's item/started + item/completed) are reduced
 *   to deltas by the adapter (see `TextBlocks`), so no consumer has to
 *   de-duplicate.
 * - Correlation is explicit: `blockId`, `callId` are fields, never parsed out of
 *   a concatenated uuid.
 * - Tool names are canonical (Read / Edit / Bash / …) whatever the provider, so
 *   the permission policy and the UI share one vocabulary.
 * - Subagent work is not dropped or flattened: it carries `parentCallId`.
 *
 * Adding a variant is a compile error in every exhaustive consumer — that is the
 * point; see `assertNever`.
 */

import type { ProviderUsageLimits, SessionContextUsage } from "@scholaraio-hub/shared";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

type AgentEventBody =
  /** The provider assigned (or confirmed) its native session id. */
  | { type: "session.started"; sessionId: string }
  /** The concrete model serving this session, once the provider reports it. */
  | { type: "model.resolved"; model: string }
  /** More visible answer text for one block. */
  | { type: "text.delta"; blockId: string; delta: string }
  /** More reasoning text for one block. */
  | { type: "reasoning.delta"; blockId: string; delta: string }
  /**
   * Arguments of a tool call the agent is still writing (raw JSON text so far).
   * The first one for a call announces it, possibly with an empty delta, so the
   * tool can appear before its arguments are complete. Always followed by
   * `tool.call` or `tool.call.invalid` for the same `callId`.
   */
  | { type: "tool.input.delta"; callId: string; name: string; delta: string }
  /** The agent decided to call a tool; `name` is canonical. */
  | { type: "tool.call"; callId: string; name: string; input: unknown }
  /** Output a running tool has produced so far (e.g. a long shell command). */
  | { type: "tool.output.delta"; callId: string; delta: string }
  /** A streamed tool call whose arguments never became valid JSON. */
  | { type: "tool.call.invalid"; callId: string; name: string; rawInput: string; reason: string }
  /**
   * A tool finished. `output` is what the agent saw; `detail` is optional
   * structured data about the result (file range read, content written, match
   * counts), in the Claude Code `tool_use_result` shape whatever the provider,
   * for renderers that want more than the raw output.
   */
  | { type: "tool.result"; callId: string; output: unknown; isError: boolean; detail?: unknown }
  /** A file (image / PDF) produced inside the turn. `key` de-duplicates. */
  | { type: "file"; key: string; mediaType: string; url: string }
  /** Something the user should see that is not part of the answer. */
  | { type: "notice"; key: string; level: "info" | "error"; text: string }
  /** Account-level rate limit telemetry, reported mid-turn by some providers. */
  | { type: "rate-limit"; limits: ProviderUsageLimits }
  /** The main thread's context window fill, as the provider counts it. */
  | { type: "context.usage"; usage: SessionContextUsage }
  /** The turn is over. Exactly one per turn. */
  | {
      type: "turn.completed";
      /** Present when the turn failed; the human-readable reason. */
      error?: string;
      usage?: TokenUsage;
      /** Largest context window the provider reported for this turn. */
      contextWindow?: number;
    };

/**
 * An event, optionally inside a subagent. `parentCallId` names the tool call
 * (Claude `Task`/`Agent`, Codex `spawnAgent`) whose subagent produced it; its
 * absence means the main agent. Block and call ids are unique per scope only
 * within their parent, so consumers key nested state by both.
 */
export type AgentEvent = AgentEventBody & { parentCallId?: string };

/** Tag events as coming from inside the subagent started by `parentCallId`. */
export function inSubagent(events: AgentEvent[], parentCallId: string | undefined): AgentEvent[] {
  return parentCallId ? events.map((event) => ({ ...event, parentCallId })) : events;
}

/** Exhaustiveness guard for switches over AgentEvent. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled agent event: ${JSON.stringify(value)}`);
}
