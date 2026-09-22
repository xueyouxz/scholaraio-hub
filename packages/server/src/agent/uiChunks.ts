/**
 * AgentEvent → AI SDK UIMessageChunk, the browser transport format.
 *
 * Because adapters already de-duplicate (see TurnState), this is a near 1:1
 * mapping. The only state kept here is which text blocks are open, since the
 * UI protocol brackets text with start/end chunks and AgentEvent does not.
 */

import type { UIMessageChunk } from "ai";
import { type AgentEvent, assertNever } from "./events.js";

export class UIChunkWriter {
  private open = new Map<string, "text" | "reasoning">();

  constructor(private readonly emit: (chunk: UIMessageChunk) => void) {}

  write(event: AgentEvent): void {
    switch (event.type) {
      case "text.delta":
        this.delta("text", event.blockId, event.delta);
        return;
      case "reasoning.delta":
        this.delta("reasoning", event.blockId, event.delta);
        return;
      case "tool.call":
        this.emit({
          type: "tool-input-available",
          toolCallId: event.callId,
          toolName: event.name,
          input: event.input,
          dynamic: true,
        });
        return;
      case "tool.call.invalid":
        this.emit({
          type: "tool-input-error",
          toolCallId: event.callId,
          toolName: event.name,
          input: event.rawInput,
          dynamic: true,
          errorText: event.reason,
        });
        return;
      case "tool.result":
        this.emit(
          event.isError
            ? {
                type: "tool-output-error",
                toolCallId: event.callId,
                errorText: String(event.output),
                dynamic: true,
              }
            : {
                type: "tool-output-available",
                toolCallId: event.callId,
                output: event.output,
                dynamic: true,
              },
        );
        return;
      case "file":
        this.emit({ type: "file", mediaType: event.mediaType, url: event.url });
        return;
      case "notice":
        this.emit({ type: "data-notice", id: event.key, data: event.text });
        return;
      case "turn.completed":
        this.close();
        return;
      case "session.started":
      case "model.resolved":
      case "rate-limit":
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

  private delta(kind: "text" | "reasoning", id: string, delta: string): void {
    if (!this.open.has(id)) {
      this.open.set(id, kind);
      this.emit({ type: `${kind}-start`, id });
    }
    this.emit({ type: `${kind}-delta`, id, delta });
  }
}
