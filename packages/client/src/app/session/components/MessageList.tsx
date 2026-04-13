import { ChevronUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MarkdownAugment, SessionMessage, SessionPagination } from "../model";
import { getMessageId, getMessageRole } from "../model";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: SessionMessage[];
  markdownAugments: Record<string, MarkdownAugment>;
  pagination: SessionPagination | null;
  loadingOlder: boolean;
  onLoadOlderMessages: () => Promise<void>;
}

function groupMessagesIntoTurns(messages: SessionMessage[]) {
  const groups: Array<{ isAssistantTurn: boolean; messages: SessionMessage[] }> = [];
  let currentAssistantGroup: SessionMessage[] = [];

  for (const message of messages) {
    const role = getMessageRole(message) ?? "assistant";
    if (role === "assistant") {
      currentAssistantGroup.push(message);
      continue;
    }

    if (currentAssistantGroup.length > 0) {
      groups.push({ isAssistantTurn: true, messages: currentAssistantGroup });
      currentAssistantGroup = [];
    }

    groups.push({ isAssistantTurn: false, messages: [message] });
  }

  if (currentAssistantGroup.length > 0) {
    groups.push({ isAssistantTurn: true, messages: currentAssistantGroup });
  }

  return groups;
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

  const groupedMessages = useMemo(() => groupMessagesIntoTurns(messages), [messages]);

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
    <div
      className="min-h-0 max-h-[calc(100vh-14rem)] overflow-auto pr-1.5 no-scrollbar"
      ref={scrollContainerRef}
      onScroll={handleScroll}
    >
      <div className="flex flex-col gap-4 py-1 pb-[220px]">
        {pagination?.hasOlderMessages ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void handleLoadOlder()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono text-on-surface-variant border border-outline-variant/20 bg-surface-container hover:bg-surface-container-high transition-colors disabled:opacity-50"
            >
              {loadingOlder ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
              {loadingOlder ? "Loading older…" : "Load older messages"}
            </button>
          </div>
        ) : null}

        {groupedMessages.map((group, groupIndex) => {
          if (!group.isAssistantTurn) {
            const message = group.messages[0];
            if (!message) return null;
            return (
              <MessageItem
                key={getMessageId(message) || `message-${groupIndex}`}
                message={message}
                augmentHtml={markdownAugments[getMessageId(message)]?.html}
              />
            );
          }

          const firstMessage = group.messages[0];
          if (!firstMessage) return null;
          return (
            <div
              key={getMessageId(firstMessage) || `assistant-turn-${groupIndex}`}
              className="relative pl-6"
            >
              {group.messages.map((message, index) => (
                <MessageItem
                  key={getMessageId(message) || `assistant-message-${groupIndex}-${index}`}
                  message={message}
                  augmentHtml={markdownAugments[getMessageId(message)]?.html}
                />
              ))}
            </div>
          );
        })}

        {groupedMessages.length === 0 ? (
          <div className="text-sm text-on-surface-variant/60 py-4">No messages yet.</div>
        ) : null}
      </div>
    </div>
  );
}
