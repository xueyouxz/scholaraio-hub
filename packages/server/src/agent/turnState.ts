/**
 * Per-turn bookkeeping shared by provider adapters.
 *
 * Providers repeat themselves: Claude streams a block and then resends it in the
 * final assistant message; Codex sends an item at item/started, streams deltas,
 * and sends the whole item again at item/completed. The adapters feed every
 * observation through this class, which emits an AgentEvent only for what is
 * new. Consumers of AgentEvent can therefore apply every event as-is.
 */

import type { AgentEvent } from "./events.js";

type TextKind = "text" | "reasoning";

export class TurnState {
  private blocks = new Map<string, { kind: TextKind; value: string }>();
  private calls = new Set<string>();
  private results = new Set<string>();
  private files = new Set<string>();
  private streamingInputs = new Set<string>();

  /** An incremental piece of text. */
  textDelta(kind: TextKind, blockId: string, delta: string): AgentEvent[] {
    if (!delta) return [];
    const block = this.block(kind, blockId);
    block.value += delta;
    return [this.textEvent(kind, blockId, delta)];
  }

  /**
   * The full text of a block so far. Only the part beyond what was already
   * emitted becomes an event; a snapshot that does not extend the block (a
   * rewrite, or a stale resend) is ignored rather than duplicated.
   */
  textSnapshot(kind: TextKind, blockId: string, text: string): AgentEvent[] {
    const block = this.block(kind, blockId);
    if (!text.startsWith(block.value)) return [];
    return this.textDelta(kind, blockId, text.slice(block.value.length));
  }

  /** Argument text of a call still being written; nothing once the call is final. */
  toolInputDelta(callId: string, name: string, delta: string): AgentEvent[] {
    if (this.calls.has(callId)) return [];
    const announcing = !this.streamingInputs.has(callId);
    this.streamingInputs.add(callId);
    if (!delta && !announcing) return [];
    return [{ type: "tool.input.delta", callId, name, delta }];
  }

  /** A tool call; repeats of the same call id are dropped. */
  toolCall(callId: string, name: string, input: unknown): AgentEvent[] {
    if (this.calls.has(callId)) return [];
    this.calls.add(callId);
    return [{ type: "tool.call", callId, name, input }];
  }

  toolCallInvalid(callId: string, name: string, rawInput: string, reason: string): AgentEvent[] {
    if (this.calls.has(callId)) return [];
    this.calls.add(callId);
    return [{ type: "tool.call.invalid", callId, name, rawInput, reason }];
  }

  /**
   * A tool result; repeats are dropped. A result whose call was never seen
   * (e.g. the call happened before we attached) gets a placeholder call first,
   * so consumers can rely on call-before-result ordering.
   */
  toolResult(callId: string, output: unknown, isError: boolean, detail?: unknown): AgentEvent[] {
    if (this.results.has(callId)) return [];
    this.results.add(callId);
    const result: AgentEvent = { type: "tool.result", callId, output, isError };
    if (detail !== undefined) result.detail = detail;
    return [...this.toolCall(callId, "Tool", {}), result];
  }

  /** Partial output of a running tool; dropped once its result is in. */
  toolOutputDelta(callId: string, delta: string): AgentEvent[] {
    if (!delta || !this.calls.has(callId) || this.results.has(callId)) return [];
    return [{ type: "tool.output.delta", callId, delta }];
  }

  file(key: string, mediaType: string, url: string): AgentEvent[] {
    if (this.files.has(key)) return [];
    this.files.add(key);
    return [{ type: "file", key, mediaType, url }];
  }

  hasToolCall(callId: string): boolean {
    return this.calls.has(callId);
  }

  private block(kind: TextKind, blockId: string) {
    let block = this.blocks.get(blockId);
    if (!block) {
      block = { kind, value: "" };
      this.blocks.set(blockId, block);
    }
    return block;
  }

  private textEvent(kind: TextKind, blockId: string, delta: string): AgentEvent {
    return kind === "text"
      ? { type: "text.delta", blockId, delta }
      : { type: "reasoning.delta", blockId, delta };
  }
}
