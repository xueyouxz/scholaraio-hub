import { useCallback, useRef } from "react";
import type { SessionContentBlock, SessionMessage } from "../model";
import { createStreamingAccumulator, reduceStreamingAccumulator } from "./streamingState";
import type { AugmentEvent, PendingEvent } from "./useStreamingMarkdown";

interface StreamingMarkdownCallbacks {
  onAugment?: (augment: AugmentEvent) => void;
  onPending?: (pending: PendingEvent) => void;
  onStreamEnd?: () => void;
  setCurrentMessageId?: (messageId: string | null) => void;
  captureHtml?: () => string | null;
}

interface UseStreamingContentOptions {
  onUpdateMessage: (message: SessionMessage) => void;
  streamingMarkdownCallbacks?: StreamingMarkdownCallbacks;
}

interface StreamingState {
  blocks: SessionContentBlock[];
}

const STREAMING_THROTTLE_MS = 50;

export function useStreamingContent({
  onUpdateMessage,
  streamingMarkdownCallbacks,
}: UseStreamingContentOptions) {
  const accumulatorRef = useRef(createStreamingAccumulator());
  const streamingContentRef = useRef<Map<string, StreamingState>>(new Map());
  const throttleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pendingIds: Set<string>;
  }>({ timer: null, pendingIds: new Set() });

  const updateStreamingMessage = useCallback(
    (messageId: string) => {
      const streaming = streamingContentRef.current.get(messageId);
      if (!streaming) return;
      onUpdateMessage({
        uuid: messageId,
        type: "assistant",
        role: "assistant",
        content: streaming.blocks,
        message: {
          role: "assistant",
          content: streaming.blocks,
        },
        _isStreaming: true,
        _source: "sdk",
      } as SessionMessage);
    },
    [onUpdateMessage],
  );

  const throttledUpdate = useCallback(
    (messageId: string) => {
      throttleRef.current.pendingIds.add(messageId);
      if (throttleRef.current.timer) return;
      throttleRef.current.timer = setTimeout(() => {
        for (const id of throttleRef.current.pendingIds) {
          updateStreamingMessage(id);
        }
        throttleRef.current.pendingIds.clear();
        throttleRef.current.timer = null;
      }, STREAMING_THROTTLE_MS);
    },
    [updateStreamingMessage],
  );

  const handleStreamEvent = useCallback(
    (data: Record<string, unknown>) => {
      if (data.type !== "stream_event") {
        return false;
      }

      const reduced = reduceStreamingAccumulator(accumulatorRef.current, data);
      if (!reduced.handled) {
        return false;
      }

      if (reduced.currentMessageId) {
        streamingMarkdownCallbacks?.setCurrentMessageId?.(reduced.currentMessageId);
      }

      const event = data.event as Record<string, unknown> | undefined;
      if (!event) return true;
      const eventType = event.type;

      if (eventType === "message_start") {
        return true;
      }
      const streamingId = reduced.updatedMessageId ?? accumulatorRef.current.currentMessageId;
      if (!streamingId) {
        return true;
      }

      if (eventType === "content_block_start") {
        const blocks = accumulatorRef.current.blocksByMessage.get(streamingId) ?? [];
        const streaming = streamingContentRef.current.get(streamingId) ?? { blocks: [] };
        streaming.blocks = [...blocks];
        streamingContentRef.current.set(streamingId, streaming);
        updateStreamingMessage(streamingId);
        return true;
      }

      if (eventType === "content_block_delta") {
        const blocks = accumulatorRef.current.blocksByMessage.get(streamingId);
        if (blocks) {
          streamingContentRef.current.set(streamingId, { blocks: [...blocks] });
          throttledUpdate(streamingId);
        }
        return true;
      }

      if (eventType === "message_stop") {
        streamingContentRef.current.delete(streamingId);
        accumulatorRef.current.currentMessageId = null;
        streamingMarkdownCallbacks?.onStreamEnd?.();
        return true;
      }

      return true;
    },
    [streamingMarkdownCallbacks, throttledUpdate, updateStreamingMessage],
  );

  const clearStreaming = useCallback(() => {
    streamingContentRef.current.clear();
    accumulatorRef.current.currentMessageId = null;
    accumulatorRef.current.blocksByMessage.clear();
  }, []);

  const cleanup = useCallback(() => {
    if (throttleRef.current.timer) {
      clearTimeout(throttleRef.current.timer);
      throttleRef.current.timer = null;
    }
  }, []);

  return {
    handleStreamEvent,
    clearStreaming,
    cleanup,
  };
}
