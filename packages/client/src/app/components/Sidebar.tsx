import type { StoredSession } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Menu, MessageSquare, Plus, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { sessionApi } from "../../core/library";

interface SidebarProps {
  isDesktop: boolean;
  isCollapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}
export function Sidebar({ isDesktop, isCollapsed, isOpen, onToggle, onClose }: SidebarProps) {
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => sessionApi.list(signal),
  });
  const collapsed = isDesktop && isCollapsed;
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:bg-surface-container"}`;
  return (
    <>
      {!isDesktop && !isOpen ? (
        <button
          className="fixed bottom-4 left-4 z-50 hub-button bg-surface-container-high"
          type="button"
          aria-label="打开导航"
          onClick={onToggle}
        >
          <Menu size={20} />
        </button>
      ) : null}
      <aside
        className={`${isDesktop ? "sticky top-0" : "fixed top-0 left-0 z-50 w-64"} h-screen bg-surface-container-low border-r border-outline-variant/15 flex flex-col p-3 ${!isOpen ? "hidden" : ""}`}
      >
        <div className="flex items-center justify-between mb-6 h-12">
          {!collapsed ? (
            <NavLink to="/library" className="text-xl font-serif font-bold text-primary">
              ScholarAIO
            </NavLink>
          ) : null}
          <button
            className="hub-button"
            type="button"
            aria-label={collapsed ? "展开导航" : "收起导航"}
            onClick={onToggle}
          >
            <Menu size={18} />
          </button>
        </div>
        <nav aria-label="主导航" className="space-y-1">
          <NavLink
            onClick={isDesktop ? undefined : onClose}
            className={navClass}
            aria-label="新对话"
            to="/sessions"
            end
          >
            <Plus size={18} />
            {!collapsed ? "新对话" : null}
          </NavLink>
          <NavLink
            onClick={isDesktop ? undefined : onClose}
            className={navClass}
            aria-label="文献库"
            to="/library"
          >
            <BookOpen size={18} />
            {!collapsed ? "文献库" : null}
          </NavLink>
          <NavLink
            onClick={isDesktop ? undefined : onClose}
            className={navClass}
            aria-label="设置"
            to="/settings"
          >
            <Settings size={18} />
            {!collapsed ? "设置" : null}
          </NavLink>
        </nav>
        {!collapsed ? (
          <div className="mt-6 pt-4 border-t border-outline-variant/15 min-h-0 overflow-auto flex-1">
            <p className="text-xs text-on-surface-variant mb-3 px-3">最近会话</p>
            {sessions.error ? (
              <p role="alert" className="text-error text-xs">
                {sessions.error.message}
              </p>
            ) : null}
            {sessions.data?.sessions.map((session: StoredSession) => (
              <NavLink
                key={session.id}
                to={`/sessions/${session.id}`}
                className={navClass}
                onClick={isDesktop ? undefined : onClose}
              >
                <MessageSquare className="shrink-0" size={14} />
                <span className="truncate">{session.title}</span>
              </NavLink>
            ))}
            {sessions.data?.sessions.length === 0 ? (
              <p className="text-xs text-on-surface-variant px-3">还没有会话</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}
