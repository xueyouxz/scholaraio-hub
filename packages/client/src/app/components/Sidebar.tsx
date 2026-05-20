import {
  ChevronUp,
  FolderKanban,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { useGlobalSessions } from "../../features/session/hooks/useGlobalSessions";
import { useProjectScope } from "./NavigationLayout";

interface NavEntry {
  id: string;
  label: string;
  to: string;
  icon: React.ElementType;
  disabled?: boolean;
}

const NAV_ENTRIES: NavEntry[] = [
  { id: "library", label: "Library", to: "/library", icon: Library },
  { id: "search", label: "Search", to: "/search", icon: Search },
  { id: "workspaces", label: "Workspaces", to: "/workspaces", icon: FolderKanban },
];

interface SidebarProps {
  isDesktop: boolean;
  isCollapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function compactLabel(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "•";
}

export function Sidebar({ isDesktop, isCollapsed, isOpen, onToggle, onClose }: SidebarProps) {
  const { sessionId } = useParams();
  const { selectedProjectId } = useProjectScope();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { sessions } = useGlobalSessions({
    projectId: selectedProjectId,
    limit: 20,
  });
  const visibleSessions = selectedProjectId ? sessions : [];

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const widthClass = isCollapsed ? "w-[84px]" : "w-[248px]";

  const visibleClass = isDesktop
    ? "translate-x-0 opacity-100"
    : isOpen
      ? "translate-x-0 opacity-100 pointer-events-auto"
      : "-translate-x-full opacity-0 pointer-events-none";

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-40 flex flex-col px-3 py-3 bg-surface-container-low border-r border-outline-variant/15 overflow-hidden transition-all duration-[220ms] ease-in-out ${widthClass} ${visibleClass}`}
    >
      {/* Brand / collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        className={`mb-4 w-full rounded-[20px] transition-all duration-200 hover:bg-surface-container flex items-center ${
          isCollapsed ? "justify-center px-0 py-2.5" : "justify-between gap-3 px-3 py-2.5"
        }`}
      >
        {!isCollapsed ? (
          <div className="min-w-0 -mt-1 text-left">
            <h1 className="font-serif text-[1.7rem] font-bold leading-none text-primary">
              ScholarAIO
            </h1>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.28em] text-on-surface-variant font-mono opacity-60">
              The Digital Atelier
            </p>
          </div>
        ) : null}
        <span className="flex shrink-0 items-center justify-center text-on-surface-variant">
          {isCollapsed ? (
            <PanelLeftOpen className="w-5 h-5" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </span>
      </button>

      {/* New chat button */}
      {!isCollapsed ? (
        <div className="mb-3">
          <Link
            to="/new-session"
            onClick={!isDesktop ? onClose : undefined}
            className="w-full flex items-center gap-2.5 rounded-[18px] px-3 py-2.5 text-sm font-medium bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Chat</span>
          </Link>
        </div>
      ) : (
        <div className="mb-3 flex justify-center">
          <Link
            to="/new-session"
            onClick={!isDesktop ? onClose : undefined}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className={`space-y-1.5 ${!isCollapsed ? "mb-5" : "mb-3"}`}>
        {NAV_ENTRIES.map((entry) => {
          const Icon = entry.icon;
          if (entry.disabled) {
            return (
              <div
                key={entry.id}
                title={isCollapsed ? entry.label : undefined}
                className={`w-full flex items-center rounded-xl transition-all duration-200 opacity-35 cursor-not-allowed ${
                  isCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
                } text-on-surface-variant`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!isCollapsed ? (
                  <span className="font-sans text-[13px] font-medium whitespace-nowrap">
                    {entry.label}
                  </span>
                ) : null}
              </div>
            );
          }
          return (
            <NavLink
              key={entry.id}
              to={entry.to}
              onClick={!isDesktop ? onClose : undefined}
              title={isCollapsed ? entry.label : undefined}
              className={({ isActive }) =>
                `w-full flex items-center rounded-xl transition-all duration-200 ${
                  isCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
                } ${
                  isActive
                    ? "bg-surface-container-high text-primary border-l-4 border-primary"
                    : "text-on-surface-variant hover:bg-surface-container"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-5 h-5 shrink-0 ${isActive ? "text-primary" : ""}`} />
                  {!isCollapsed ? (
                    <span className="font-sans text-[13px] font-medium whitespace-nowrap">
                      {entry.label}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Session list (only when expanded and project selected) */}
      {!isCollapsed ? (
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1 border-t border-outline-variant/10 pt-3">
          <p className="px-1 mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant/60">
            Recents
          </p>
          {visibleSessions.length > 0 ? (
            <div className="space-y-1">
              {visibleSessions.map((session) => {
                const label = session.customTitle ?? session.title ?? "Untitled";
                const isActive = session.id === sessionId;
                return (
                  <Link
                    key={session.id}
                    to={`/projects/${session.projectId}/sessions/${session.id}`}
                    onClick={!isDesktop ? onClose : undefined}
                    className={`block w-full rounded-xl px-3 py-1.5 pr-9 text-left transition-colors ${
                      isActive
                        ? "bg-surface-container text-primary"
                        : "text-on-surface hover:bg-surface-container"
                    }`}
                  >
                    <p className="line-clamp-1 text-[13px]">{label}</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-1 text-[12px] text-on-surface-variant/60">
              {selectedProjectId
                ? "No sessions in this project."
                : "Select a project in Settings to browse sessions."}
            </p>
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* User profile + settings popup */}
      <div className="mt-3 pt-3 border-t border-outline-variant/10 relative" ref={userMenuRef}>
        {/* Settings popup — slides up above profile button */}
        {userMenuOpen ? (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-xl overflow-hidden">
            <NavLink
              to="/settings"
              onClick={() => {
                setUserMenuOpen(false);
                if (!isDesktop) onClose();
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  isActive
                    ? "text-primary bg-primary/5"
                    : "text-on-surface hover:bg-surface-container"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Settings
                    className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : "text-on-surface-variant"}`}
                  />
                  {!isCollapsed ? (
                    <span className="font-sans text-[13px] font-medium">Settings</span>
                  ) : null}
                </>
              )}
            </NavLink>
          </div>
        ) : null}

        {/* User profile trigger */}
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className={`w-full rounded-[20px] bg-surface-container transition-all duration-200 hover:bg-surface-container-high ${
            isCollapsed ? "flex justify-center p-2.5" : "flex items-center gap-3 px-3 py-3"
          } ${userMenuOpen ? "bg-surface-container-high" : ""}`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary">
            <User className="w-4 h-4" />
          </div>
          {!isCollapsed ? (
            <>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-bold text-on-surface">Research User</p>
                <p className="text-[10px] text-on-surface-variant font-mono">Local Workbench</p>
              </div>
              <ChevronUp
                className={`shrink-0 w-4 h-4 text-on-surface-variant transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
              />
            </>
          ) : null}
        </button>
      </div>
    </aside>
  );
}

export { compactLabel };
