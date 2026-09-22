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
 *
 * Adding a variant is a compile error in every exhaustive consumer — that is the
 * point; see `assertNever`.
 */

import type { ProviderUsageLimits } from "@scholaraio-hub/shared";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type AgentEvent =
  /** The provider assigned (or confirmed) its native session id. */
  | { type: "session.started"; sessionId: string }
  /** The concrete model serving this session, once the provider reports it. */
  | { type: "model.resolved"; model: string }
  /** More visible answer text for one block. */
  | { type: "text.delta"; blockId: string; delta: string }
  /** More reasoning text for one block. */
  | { type: "reasoning.delta"; blockId: string; delta: string }
  /** The agent decided to call a tool; `name` is canonical. */
  | { type: "tool.call"; callId: string; name: string; input: unknown }
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
  /** The turn is over. Exactly one per turn. */
  | {
      type: "turn.completed";
      /** Present when the turn failed; the human-readable reason. */
      error?: string;
      usage?: TokenUsage;
      /** Largest context window the provider reported for this turn. */
      contextWindow?: number;
    };

export type AgentEventType = AgentEvent["type"];

/** Exhaustiveness guard for switches over AgentEvent. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled agent event: ${JSON.stringify(value)}`);
}
