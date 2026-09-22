/**
 * Keeps the text of the assistant message that is streaming right now, so a
 * client that connects mid-turn can be shown what it missed.
 *
 * This is a view onto the stream, not a store: it holds one message at a time
 * and drops it as soon as that message completes.
 */

import type { SDKMessage } from "../sdk/types.js";

function streamEvent(message: SDKMessage): Record<string, unknown> | null {
  if (message.type !== "stream_event") return null;
  const event = (message as { event?: unknown }).event;
  return event && typeof event === "object" ? (event as Record<string, unknown>) : null;
}

/** The id of the message a chunk belongs to, when the chunk announces one. */
export function extractStreamingMessageId(message: SDKMessage): string | null {
  const event = streamEvent(message);
  if (event?.type === "message_start") {
    const started = event.message as Record<string, unknown> | undefined;
    return typeof started?.id === "string" ? started.id : null;
  }
  if (message.type === "assistant" && typeof message.uuid === "string") {
    return message.uuid;
  }
  return null;
}

/** Visible text carried by a chunk, if any. */
export function extractStreamingText(message: SDKMessage): string | null {
  const event = streamEvent(message);
  if (event?.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") return delta.text;
  }
  if (message.type === "assistant") {
    const content =
      (message as { message?: { content?: unknown }; content?: unknown }).message?.content ??
      (message as { content?: unknown }).content;
    return typeof content === "string" ? content : null;
  }
  return null;
}

export function isStreamingCompleteMessage(message: SDKMessage): boolean {
  const event = streamEvent(message);
  return event?.type === "message_stop" || message.type === "result";
}

export class StreamingCatchUp {
  private messageId: string | null = null;
  private text = "";

  /** Feed every message the process observes. */
  accept(message: SDKMessage): void {
    const startedId = extractStreamingMessageId(message);
    if (startedId && this.messageId !== startedId) {
      this.messageId = startedId;
      this.text = "";
    }

    const text = extractStreamingText(message);
    if (text && this.messageId) this.text += text;

    if (isStreamingCompleteMessage(message)) this.clear();
  }

  snapshot(): { messageId: string; text: string } | null {
    if (!this.messageId || !this.text) return null;
    return { messageId: this.messageId, text: this.text };
  }

  clear(): void {
    this.messageId = null;
    this.text = "";
  }
}
