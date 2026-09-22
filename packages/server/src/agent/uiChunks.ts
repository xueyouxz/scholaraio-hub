/**
 * AgentEvent → AI SDK UIMessageChunk, the browser transport format.
 *
 * Because adapters already de-duplicate (see TurnState), this is a near 1:1
 * mapping. The only state kept here is which text blocks are open, since the
 * UI protocol brackets text with start/end chunks and AgentEvent does not.
 */

import type { SessionNotice, ToolOutput } from "@scholaraio-hub/shared";
import type { UIMessageChunk } from "ai";
import { type AgentEvent, assertNever } from "./events.js";

/**
 * Running output is a preview, not a record: keep the tail, like a terminal.
 * The final tool result carries the full output.
 */
const MAX_PARTIAL_OUTPUT = 32 * 1024;

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
  private partialOutput = new Map<string, string>();

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
        // AI SDK preliminary outputs replace each other, so send the whole
        // accumulated output each time; the final result replaces the last one.
        let content = (this.partialOutput.get(event.callId) ?? "") + event.delta;
        if (content.length > MAX_PARTIAL_OUTPUT) content = `…${content.slice(-MAX_PARTIAL_OUTPUT)}`;
        this.partialOutput.set(event.callId, content);
        const output: ToolOutput = { content, isError: false };
        this.emit({
          type: "tool-output-available",
          toolCallId: event.callId,
          output,
          dynamic: true,
          preliminary: true,
        });
        return;
      }
      case "tool.result": {
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
      case "model.resolved":
      case "rate-limit":
      case "context.usage":
        return;
      default:
        assertNever(event);
    }
  }

  /** Close every open block. Safe to call more than once. */
  close(): void {
    for (const [id, kind] of this.open) this.emit({ type: `${kind}-end`, id });
    this.open.clear();
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
 */
export function appendReplayChunk(chunks: UIMessageChunk[], chunk: UIMessageChunk): void {
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
