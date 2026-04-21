import { ChevronUp, Loader2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { preprocessMessages } from "../lib/preprocessMessages";
import type { MarkdownAugment, SessionMessage, SessionPagination } from "../model";
import type { RenderItem } from "../types/renderItems";
import { RenderItemComponent } from "./RenderItemComponent";

interface MessageListProps {
  messages: SessionMessage[];
  markdownAugments: Record<string, MarkdownAugment>;
  pagination: SessionPagination | null;
  loadingOlder: boolean;
  onLoadOlderMessages: () => Promise<void>;
  sessionProvider?: string;
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

export function MessageList({
  messages,
  markdownAugments,
  pagination,
  loadingOlder,
  onLoadOlderMessages,
  sessionProvider,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);

  const renderItems = useMemo(
    () => preprocessMessages(messages, { markdown: markdownAugments }),
    [messages, markdownAugments],
  );
  const groups = useMemo(() => groupRenderItems(renderItems), [renderItems]);

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
      className="message-list flex-1 min-h-0 overflow-auto pr-1.5 no-scrollbar"
      ref={scrollContainerRef}
      onScroll={handleScroll}
    >
      <div className="flex flex-col gap-4 py-1 pb-[220px] w-full max-w-[44rem] mx-auto px-4">
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

        {groups.map((group) => {
          if (!group.isAssistantTurn) {
            return (
              <Fragment key={group.key}>
                {group.items.map((item) => (
                  <RenderItemComponent
                    key={item.id}
                    item={item}
                    sessionProvider={sessionProvider}
                  />
                ))}
              </Fragment>
            );
          }
          return (
            <div key={group.key} className="assistant-turn relative pl-6">
              {group.items.map((item) => (
                <RenderItemComponent key={item.id} item={item} sessionProvider={sessionProvider} />
              ))}
            </div>
          );
        })}

        {groups.length === 0 ? (
          <div className="text-sm text-on-surface-variant/60 py-4">No messages yet.</div>
        ) : null}
      </div>
    </div>
  );
}
