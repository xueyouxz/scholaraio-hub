import type { SessionContentBlock } from "../model";

export interface StreamingAccumulator {
  currentMessageId: string | null;
  blocksByMessage: Map<string, SessionContentBlock[]>;
}

export type StreamingStateResult =
  | { handled: false }
  | {
      handled: true;
      currentMessageId: string | null;
      updatedMessageId?: string;
      streamEnded?: boolean;
    };

export function createStreamingAccumulator(): StreamingAccumulator {
  return {
    currentMessageId: null,
    blocksByMessage: new Map(),
  };
}

export function reduceStreamingAccumulator(
  state: StreamingAccumulator,
  data: Record<string, unknown>,
): StreamingStateResult {
  if (data.type !== "stream_event") {
    return { handled: false };
  }

  const event = data.event as Record<string, unknown> | undefined;
  if (!event) {
    return { handled: true, currentMessageId: state.currentMessageId };
  }

  if (event.type === "message_start") {
    const message = event.message as Record<string, unknown> | undefined;
    if (typeof message?.id === "string") {
      state.currentMessageId = message.id;
    }
    return { handled: true, currentMessageId: state.currentMessageId };
  }

  const messageId = state.currentMessageId ?? `stream-${Date.now()}`;

  if (event.type === "content_block_start") {
    const index = typeof event.index === "number" ? event.index : 0;
    const contentBlock = event.content_block as Record<string, unknown> | undefined;
    const blocks = state.blocksByMessage.get(messageId) ?? [];
    while (blocks.length <= index) {
      blocks.push({ type: "text", text: "" });
    }
    blocks[index] = {
      type: typeof contentBlock?.type === "string" ? contentBlock.type : "text",
      text: typeof contentBlock?.text === "string" ? contentBlock.text : "",
      thinking: typeof contentBlock?.thinking === "string" ? contentBlock.thinking : undefined,
    };
    state.blocksByMessage.set(messageId, blocks);
    return {
      handled: true,
      currentMessageId: state.currentMessageId,
      updatedMessageId: messageId,
    };
  }

  if (event.type === "content_block_delta") {
    const index = typeof event.index === "number" ? event.index : 0;
    const delta = event.delta as Record<string, unknown> | undefined;
    const blocks = state.blocksByMessage.get(messageId);
    const block = blocks?.[index];
    if (blocks && block && delta) {
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        block.text = `${block.text ?? ""}${delta.text}`;
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        block.thinking = `${block.thinking ?? ""}${delta.thinking}`;
      }
    }
    return {
      handled: true,
      currentMessageId: state.currentMessageId,
      updatedMessageId: blocks ? messageId : undefined,
    };
  }

  if (event.type === "message_stop") {
    state.blocksByMessage.delete(messageId);
    return {
      handled: true,
      currentMessageId: state.currentMessageId,
      streamEnded: true,
    };
  }

  return { handled: true, currentMessageId: state.currentMessageId };
}
