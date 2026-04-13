import { MoreHorizontal } from "lucide-react";
import type React from "react";
import type { SessionItem } from "../types/ui";

interface ChatHistoryItemProps {
  item: SessionItem;
  showActions?: boolean;
}

const ChatHistoryItem: React.FC<ChatHistoryItemProps> = ({ item, showActions = false }) => (
  <div className="relative group">
    <div
      className={`w-full rounded-xl px-3 py-1.5 pr-9 text-left transition-colors block ${
        item.active
          ? "bg-surface-container text-primary"
          : "text-on-surface hover:bg-surface-container"
      }`}
    >
      <p className="line-clamp-1 text-[13px] text-current">{item.title}</p>
    </div>
    {showActions ? (
      <>
        <button className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md bg-surface-container-high text-on-surface-variant">
          <MoreHorizontal className="w-4 h-4" />
        </button>
        <div className="absolute right-1 top-8 z-20 w-36 rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl p-1.5">
          <div className="w-full px-2.5 py-2 rounded-lg text-sm">重命名</div>
          <div className="w-full px-2.5 py-2 rounded-lg text-sm text-error">删除</div>
        </div>
      </>
    ) : null}
  </div>
);

export default ChatHistoryItem;
