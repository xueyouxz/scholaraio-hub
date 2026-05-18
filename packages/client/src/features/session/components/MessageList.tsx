import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from "react";
import { type ActiveToolApproval, preprocessMessages } from "../lib/preprocessMessages";
import type { MarkdownAugment, SessionMessage, SessionPagination } from "../model";
import type { RenderItem } from "../types/renderItems";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { RenderItemComponent } from "./RenderItemComponent";

interface PendingMessage {
  tempId: string;
  content: string;
  status?: string;
}

interface MessageListProps {
  messages: SessionMessage[];
  markdownAugments: Record<string, MarkdownAugment>;
  pagination: SessionPagination | null;
  loadingOlder: boolean;
  onLoadOlderMessages: () => Promise<void>;
  sessionProvider?: string;
  isProcessing?: boolean;
  isCompacting?: boolean;
  /** Increment to force-scroll to bottom (e.g. after user sends a message) */
  scrollTrigger?: number;
  activeToolApproval?: ActiveToolApproval;
  /** Optimistic send bubbles shown until server confirms */
  pendingMessages?: PendingMessage[];
}

interface RenderGroup {
  key: string;
  isAssistantTurn: boolean;
  items: RenderItem[];
}

function groupRenderItems(items: RenderItem[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let currentTurn: RenderItem[] = [];
  let turnStartId: string | null = null;

  const flushTurn = () => {
    if (currentTurn.length === 0) return;
    groups.push({
      key: `turn:${turnStartId ?? groups.length}`,
      isAssistantTurn: true,
      items: currentTurn,
    });
    currentTurn = [];
    turnStartId = null;
  };

  for (const item of items) {
    const isUserOrSetup = item.type === "user_prompt" || item.type === "session_setup";
    if (isUserOrSetup) {
      flushTurn();
      groups.push({ key: `single:${item.id}`, isAssistantTurn: false, items: [item] });
      continue;
    }
    if (currentTurn.length === 0) turnStartId = item.id;
    currentTurn.push(item);
  }

  flushTurn();
  return groups;
}

export const MessageList = memo(function MessageList({
  messages,
  markdownAugments,
  pagination,
  loadingOlder,
  onLoadOlderMessages,
  sessionProvider,
  isProcessing = false,
  isCompacting = false,
  scrollTrigger = 0,
  activeToolApproval,
  pendingMessages = [],
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const followUpScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeightRef = useRef(0);

  const renderItems = useMemo(
    () => preprocessMessages(messages, { markdown: markdownAugments, activeToolApproval }),
    [messages, markdownAugments, activeToolApproval],
  );
  const groups = useMemo(() => groupRenderItems(renderItems), [renderItems]);

  const scrollToBottom = useCallback((container: HTMLElement) => {
    isProgrammaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight - container.clientHeight;
    lastHeightRef.current = container.scrollHeight;
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });

    // Schedule a follow-up scroll to catch async rendering (markdown, syntax highlighting)
    if (followUpScrollRef.current !== null) clearTimeout(followUpScrollRef.current);
    followUpScrollRef.current = setTimeout(() => {
      followUpScrollRef.current = null;
      if (shouldAutoScrollRef.current) {
        isProgrammaticScrollRef.current = true;
        container.scrollTop = container.scrollHeight - container.clientHeight;
        lastHeightRef.current = container.scrollHeight;
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
        });
      }
    }, 50);
  }, []);

  const handleScroll = useCallback(() => {
    const container = listRef.current?.parentElement;
    if (!container || isProgrammaticScrollRef.current) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 100;
  }, []);

  // Attach scroll listener
  useEffect(() => {
    const container = listRef.current?.parentElement;
    if (!container) return;
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // ResizeObserver: auto-scroll when content height grows (async markdown rendering)
  useEffect(() => {
    const container = listRef.current?.parentElement;
    const inner = listRef.current;
    if (!container || !inner) return;

    lastHeightRef.current = container.scrollHeight;

    const observer = new ResizeObserver(() => {
      const newHeight = container.scrollHeight;
      if (newHeight > lastHeightRef.current && shouldAutoScrollRef.current) {
        scrollToBottom(container);
      } else {
        lastHeightRef.current = newHeight;
      }
    });

    observer.observe(inner);
    return () => {
      observer.disconnect();
      if (followUpScrollRef.current !== null) clearTimeout(followUpScrollRef.current);
    };
  }, [scrollToBottom]);

  // Initial scroll to bottom on first render
  useEffect(() => {
    if (isInitialLoadRef.current && renderItems.length > 0) {
      const container = listRef.current?.parentElement;
      if (container) scrollToBottom(container);
      isInitialLoadRef.current = false;
    }
  }, [renderItems.length, scrollToBottom]);

  // Force scroll when user sends a message
  useEffect(() => {
    if (scrollTrigger > 0) {
      shouldAutoScrollRef.current = true;
      const container = listRef.current?.parentElement;
      if (container) scrollToBottom(container);
    }
  }, [scrollTrigger, scrollToBottom]);

  const handleLoadOlder = useCallback(async () => {
    const container = listRef.current?.parentElement;
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
      lastHeightRef.current = container.scrollHeight;
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });
  }, [onLoadOlderMessages]);

  return (
    <div className="message-list" ref={listRef}>
      {pagination?.hasOlderMessages ? (
        <div className="load-older-messages">
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void handleLoadOlder()}
            className="load-older-button"
          >
            {loadingOlder ? "Loading older…" : "Load older messages"}
          </button>
        </div>
      ) : null}

      {groups.map((group) => {
        if (!group.isAssistantTurn) {
          return (
            <Fragment key={group.key}>
              {group.items.map((item) => (
                <RenderItemComponent key={item.id} item={item} sessionProvider={sessionProvider} />
              ))}
            </Fragment>
          );
        }
        return (
          <div key={group.key} className="assistant-turn">
            {group.items.map((item) => (
              <RenderItemComponent key={item.id} item={item} sessionProvider={sessionProvider} />
            ))}
          </div>
        );
      })}

      {/* Optimistic send bubbles — shown until server confirms the message */}
      {pendingMessages.map((pending) => (
        <div key={pending.tempId} className="pending-message">
          <div className="message-user-prompt pending-message-bubble">{pending.content}</div>
          <div className="pending-message-status">{pending.status ?? "Sending…"}</div>
        </div>
      ))}

      {/* Context compaction indicator */}
      {isCompacting ? (
        <div className="system-message system-message-compacting">
          <span className="system-message-icon spinning">⟳</span>
          <span className="system-message-text">Compacting context…</span>
        </div>
      ) : null}

      <ProcessingIndicator isProcessing={isProcessing} />
    </div>
  );
});
