import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MarkdownAugment, SessionMessage, SessionPagination } from "../model";
import { getMessageId } from "../model";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: SessionMessage[];
  markdownAugments: Record<string, MarkdownAugment>;
  pagination: SessionPagination | null;
  loadingOlder: boolean;
  onLoadOlderMessages: () => Promise<void>;
}

export function MessageList({
  messages,
  markdownAugments,
  pagination,
  loadingOlder,
  onLoadOlderMessages,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);

  const orderedMessages = useMemo(() => messages, [messages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isProgrammaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight - container.clientHeight;
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  });

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || isProgrammaticScrollRef.current) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 100;
  }, []);

  const handleLoadOlder = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      await onLoadOlderMessages();
      return;
    }
    const beforeHeight = container.scrollHeight;
    const beforeTop = container.scrollTop;
    await onLoadOlderMessages();
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = true;
      container.scrollTop = beforeTop + (container.scrollHeight - beforeHeight);
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });
  }, [onLoadOlderMessages]);

  return (
    <div className="session-message-scroll" ref={scrollContainerRef} onScroll={handleScroll}>
      <div className="session-message-list">
        {pagination?.hasOlderMessages ? (
          <div className="load-older-messages">
            <button
              type="button"
              className="ghost"
              disabled={loadingOlder}
              onClick={() => void handleLoadOlder()}
            >
              {loadingOlder ? "Loading older…" : "Load older messages"}
            </button>
          </div>
        ) : null}
        {orderedMessages.map((message, index) => (
          <MessageItem
            key={getMessageId(message) || `message-${index}`}
            message={message}
            augmentHtml={markdownAugments[getMessageId(message)]?.html}
          />
        ))}
        {orderedMessages.length === 0 ? <div className="empty">No messages yet.</div> : null}
      </div>
    </div>
  );
}
