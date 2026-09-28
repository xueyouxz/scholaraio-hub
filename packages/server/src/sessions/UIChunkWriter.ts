/**
 * AgentEvent → AI SDK UIMessageChunk, the browser transport format.
 *
 * Because adapters already de-duplicate (see TurnState), this is a near 1:1
 * mapping. The only state kept here is which text blocks are open, since the
 * UI protocol brackets text with start/end chunks and AgentEvent does not.
 */

import type { SessionNotice, ToolOutput } from "@scholaraio-hub/shared";
import type { UIMessageChunk } from "ai";
import { type AgentEvent, assertNever } from "../providers/events.js";

/**
 * Running output is a preview, not a record: keep the tail, like a terminal.
 * The final tool result carries the full output.
 */
const MAX_PARTIAL_OUTPUT = 32 * 1024;
/**
 * The most often a running tool's preview is sent. Each one carries the whole
 * tail, so a command printing thousands of lines must not send one per line.
 */
const PARTIAL_OUTPUT_INTERVAL_MS = 250;

interface PartialOutput {
  content: string;
  /** When the preview was last sent. */
  sentAt: number;
  /** Sends the latest preview once the interval has passed. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Where nested (subagent) parts say which call they belong to: tool parts in
 * `toolMetadata`, text and reasoning parts in `providerMetadata.hub`. Read back
 * by the client with `parentCallIdOf`.
 */
function toolScope(parentCallId: string | undefined): { toolMetadata?: { parentCallId: string } } {
  return parentCallId ? { toolMetadata: { parentCallId } } : {};
}

export class UIChunkWriter {
  private open = new Map<string, "text" | "reasoning">();
  /** Calls whose arguments are streaming, so the start chunk is sent once. */
  private inputStarted = new Set<string>();
  /** Output accumulated so far for tools that are still running. */
  private partialOutput = new Map<string, PartialOutput>();

  constructor(private readonly emit: (chunk: UIMessageChunk) => void) {}

  write(event: AgentEvent): void {
    switch (event.type) {
      case "text.delta":
        this.delta("text", event.blockId, event.delta, event.parentCallId);
        return;
      case "reasoning.delta":
        this.delta("reasoning", event.blockId, event.delta, event.parentCallId);
        return;
      case "tool.input.delta":
        if (!this.inputStarted.has(event.callId)) {
          this.inputStarted.add(event.callId);
          this.emit({
            type: "tool-input-start",
            toolCallId: event.callId,
            toolName: event.name,
            dynamic: true,
            ...toolScope(event.parentCallId),
          });
        }
        if (event.delta) {
          this.emit({
            type: "tool-input-delta",
            toolCallId: event.callId,
            inputTextDelta: event.delta,
          });
        }
        return;
      case "tool.call":
        this.inputStarted.delete(event.callId);
        this.emit({
          type: "tool-input-available",
          toolCallId: event.callId,
          toolName: event.name,
          input: event.input,
          dynamic: true,
          ...toolScope(event.parentCallId),
        });
        return;
      case "tool.call.invalid":
        this.inputStarted.delete(event.callId);
        this.emit({
          type: "tool-input-error",
          toolCallId: event.callId,
          toolName: event.name,
          input: event.rawInput,
          dynamic: true,
          errorText: event.reason,
          ...toolScope(event.parentCallId),
        });
        return;
      case "tool.output.delta": {
        const partial = this.partialOutput.get(event.callId) ?? { content: "", sentAt: 0 };
        partial.content += event.delta;
        if (partial.content.length > MAX_PARTIAL_OUTPUT)
          partial.content = `…${partial.content.slice(-MAX_PARTIAL_OUTPUT)}`;
        this.partialOutput.set(event.callId, partial);
        const wait = partial.sentAt + PARTIAL_OUTPUT_INTERVAL_MS - Date.now();
        if (wait <= 0) this.sendPartialOutput(event.callId, partial);
        else
          partial.timer ??= setTimeout(() => this.sendPartialOutput(event.callId, partial), wait);
        return;
      }
      case "tool.result": {
        clearTimeout(this.partialOutput.get(event.callId)?.timer);
        this.partialOutput.delete(event.callId);
        // Always an output part, failures included, so the browser keeps the
        // failed command's output and structured detail (see ToolOutput).
        const output: ToolOutput = {
          content: event.output,
          isError: event.isError,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        };
        this.emit({
          type: "tool-output-available",
          toolCallId: event.callId,
          output,
          dynamic: true,
        });
        return;
      }
      case "file":
        this.emit({ type: "file", mediaType: event.mediaType, url: event.url });
        return;
      case "notice":
        this.emit({
          type: "data-notice",
          id: event.key,
          data: { level: event.level, text: event.text } satisfies SessionNotice,
        });
        return;
      case "turn.completed":
        this.close();
        return;
      case "session.started":
      case "prompt.recorded":
      case "model.resolved":
      case "rate-limit":
      case "context.usage":
        return;
      default:
        assertNever(event);
    }
  }

  /**
   * Close every open block and drop running tools' previews, pending ones
   * included: nothing is sent after this. Safe to call more than once.
   */
  close(): void {
    for (const [id, kind] of this.open) this.emit({ type: `${kind}-end`, id });
    this.open.clear();
    for (const partial of this.partialOutput.values()) clearTimeout(partial.timer);
    this.partialOutput.clear();
  }

  /**
   * AI SDK preliminary outputs replace each other, so each one carries the
   * whole accumulated output; the final result replaces the last one.
   */
  private sendPartialOutput(callId: string, partial: PartialOutput): void {
    clearTimeout(partial.timer);
    partial.timer = undefined;
    partial.sentAt = Date.now();
    const output: ToolOutput = { content: partial.content, isError: false };
    this.emit({
      type: "tool-output-available",
      toolCallId: callId,
      output,
      dynamic: true,
      preliminary: true,
    });
  }

  private delta(
    kind: "text" | "reasoning",
    blockId: string,
    delta: string,
    parentCallId: string | undefined,
  ): void {
    // Block ids are only unique within one agent.
    const id = parentCallId ? `${parentCallId}/${blockId}` : blockId;
    if (!this.open.has(id)) {
      this.open.set(id, kind);
      this.emit({
        type: `${kind}-start`,
        id,
        ...(parentCallId ? { providerMetadata: { hub: { parentCallId } } } : {}),
      });
    }
    this.emit({ type: `${kind}-delta`, id, delta });
  }
}

/**
 * Append a chunk to a run's replay buffer. A preliminary tool output supersedes
 * the previous one for the same call, so a reconnecting client only replays the
 * latest and the buffer does not grow with every line a long command prints.
 * A text or reasoning delta that continues the block of the last chunk is
 * joined to it: a reconnect replays blocks, not every token.
 */
export function appendReplayChunk(chunks: UIMessageChunk[], chunk: UIMessageChunk): void {
  const last = chunks.at(-1);
  if (
    (chunk.type === "text-delta" || chunk.type === "reasoning-delta") &&
    last?.type === chunk.type &&
    last.id === chunk.id
  ) {
    // A new chunk: the one sent live is not changed after the fact.
    chunks[chunks.length - 1] = { ...last, delta: last.delta + chunk.delta };
    return;
  }
  if (chunk.type === "tool-output-available" && chunk.preliminary) {
    for (let index = chunks.length - 1; index >= 0; index--) {
      const previous = chunks[index];
      if (
        previous?.type === "tool-output-available" &&
        previous.preliminary === true &&
        previous.toolCallId === chunk.toolCallId
      ) {
        chunks[index] = chunk;
        return;
      }
    }
  }
  chunks.push(chunk);
}
