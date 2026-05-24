import { toUrlProjectId } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronUp,
  FolderKanban,
  FolderOpen,
  Library,
  Loader2,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api, scholar } from "../../core/api";
import type { ProviderGroupFilter } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { ProjectSummary } from "../../core/types";
import type { GlobalSessionItem } from "../../features/session/api/client";
import { useGroupSessions } from "../../features/session/hooks/useGroupSessions";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, useProjectScope } from "./NavigationLayout";

const COLLAPSED_WIDTH = 60;

const CLAUDE_PROVIDERS = ["claude", "claude-ollama"];
const CODEX_PROVIDERS = ["codex", "codex-oss"];

function providerNamesForGroup(provider: ProviderGroupFilter | null): string[] | null {
  if (provider === "claude") return CLAUDE_PROVIDERS;
  if (provider === "codex") return CODEX_PROVIDERS;
  return null;
}

function projectSupportsProvider(project: ProjectSummary, provider: ProviderGroupFilter | null) {
  const providerNames = providerNamesForGroup(provider);
  if (!providerNames) return true;
  return providerNames.some(
    (name) => project.provider === name || project.availableProviders?.includes(name),
  );
}

function projectActivityForProvider(
  project: ProjectSummary | undefined,
  provider: ProviderGroupFilter | null,
) {
  if (!project) return null;
  const providerNames = providerNamesForGroup(provider);
  if (!providerNames) return project.lastActivity ?? null;
  return (
    providerNames
      .map((name) => project.providerLastActivity?.[name])
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort()
      .at(-1) ?? null
  );
}

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
  { id: "skills", label: "Skills", to: "/skills", icon: Sparkles },
];

interface SidebarProps {
  isDesktop: boolean;
  isCollapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Current expanded width — used as the drag start baseline. */
  expandedWidth: number;
  /**
   * Called on every mousemove during drag.
   * The parent writes gridTemplateColumns directly (no React re-render).
   */
  onDragMove: (width: number) => void;
  /** Called once on mouseup — triggers a single React re-render to persist. */
  onDragEnd: (finalWidth: number) => void;
}

function compactLabel(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "•";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "今天";
  if (days < 7) return `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  const months = Math.floor(days / 30);
  return `${months}月前`;
}

// ─── Session item ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  isActive,
  onClose,
  isDesktop,
}: {
  session: GlobalSessionItem;
  isActive: boolean;
  onClose: () => void;
  isDesktop: boolean;
}) {
  const label = session.customTitle ?? session.title ?? "Untitled";
  const isRunning = session.activity === "in-turn" || session.activity === "waiting-input";
  return (
    <Link
      to={`/projects/${session.projectId}/sessions/${session.id}`}
      onClick={!isDesktop ? onClose : undefined}
      className={`group flex items-center justify-between w-full rounded-xl px-3 py-1.5 text-left transition-colors ${
        isActive
          ? "bg-surface-container text-primary"
          : "text-on-surface hover:bg-surface-container"
      }`}
    >
      <p className="line-clamp-1 text-[13px] min-w-0 flex-1">{label}</p>
      <span className="flex items-center gap-1.5 shrink-0 ml-2">
        {isRunning ? <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> : null}
        <span className="text-[10px] text-on-surface-variant/60 whitespace-nowrap">
          {relativeTime(session.updatedAt)}
        </span>
      </span>
    </Link>
  );
}

// ─── Group ─────────────────────────────────────────────────────────────────────

function SidebarGroup({
  projectId,
  name,
  icon: Icon,
  sessionId,
  isDesktop,
  onClose,
  onAddSession,
  provider,
  loadGroup,
  getGroup,
}: {
  projectId: string;
  name: string;
  icon: React.ElementType;
  sessionId: string | undefined;
  isDesktop: boolean;
  onClose: () => void;
  onAddSession: (projectId: string) => void;
  provider: ProviderGroupFilter | null;
  loadGroup: (projectId: string, provider?: ProviderGroupFilter | null) => void;
  getGroup: (
    projectId: string,
    provider?: ProviderGroupFilter | null,
  ) => {
    sessions: GlobalSessionItem[];
    loading: boolean;
    loaded: boolean;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const { sessions, loading, loaded } = getGroup(projectId, provider);

  useEffect(() => {
    if (expanded && !loaded && !loading) {
      loadGroup(projectId, provider);
    }
  }, [expanded, loaded, loading, loadGroup, projectId, provider]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      loadGroup(projectId, provider);
    }
  };

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 group/header">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-lg hover:bg-surface-container transition-colors text-left"
        >
          <Icon className="w-4 h-4 shrink-0 text-on-surface-variant" />
          <span className="text-[12px] font-medium text-on-surface truncate">{name}</span>
        </button>
        <button
          type="button"
          title={`在 ${name} 中新建会话`}
          onClick={() => onAddSession(projectId)}
          className="shrink-0 p-1 rounded-lg opacity-0 group-hover/header:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded ? (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-on-surface-variant/60">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[12px]">加载中…</span>
            </div>
          ) : sessions.length > 0 ? (
            sessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                isActive={s.id === sessionId}
                isDesktop={isDesktop}
                onClose={onClose}
              />
            ))
          ) : (
            <p className="px-3 py-1.5 text-[12px] text-on-surface-variant/50">暂无对话</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Section (Workspaces / Projects) ──────────────────────────────────────────

function SidebarSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 mb-0.5 rounded-lg hover:bg-surface-container transition-colors group/section"
      >
        <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors">
          {title}
        </span>
        <span className="min-w-[18px] text-center text-[10px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors">
          {count}
        </span>
      </button>
      {!collapsed ? children : null}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({
  isDesktop,
  isCollapsed,
  isOpen,
  onToggle,
  onClose,
  expandedWidth,
  onDragMove,
  onDragEnd,
}: SidebarProps) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { setSelectedProjectId, setSelectedProvider, selectedProvider } = useProjectScope();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const workspacesQuery = useQuery({
    queryKey: queryKeys.scholar.workspaces(),
    queryFn: ({ signal }) => scholar.getWorkspaces({ signal }),
    select: (data) => data.workspaces,
    staleTime: 5 * 60_000,
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.getProjects({ signal }),
    select: (data) => data.projects,
    staleTime: 5 * 60_000,
  });
  const workspaces = workspacesQuery.data ?? [];
  const projects: ProjectSummary[] = projectsQuery.data ?? [];
  const { loadGroup, getGroup } = useGroupSessions();

  const [projectsVisible, setProjectsVisible] = useState(true);
  const prevProviderRef = useRef(selectedProvider);

  useEffect(() => {
    if (prevProviderRef.current === selectedProvider) return;
    prevProviderRef.current = selectedProvider;
    setProjectsVisible(false);
    const t = setTimeout(() => setProjectsVisible(true), 160);
    return () => clearTimeout(t);
  }, [selectedProvider]);

  const projectsByName = useMemo(
    () => new Map(projects.map((p) => [p.name ?? p.path.split("/").pop() ?? "", p])),
    [projects],
  );
  const projectsByPath = useMemo(() => new Map(projects.map((p) => [p.path, p])), [projects]);

  const workspaceNames = useMemo(() => new Set(workspaces.map((w) => w.name)), [workspaces]);

  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((a, b) => {
        const projectA = projectsByPath.get(a.path) ?? projectsByName.get(a.name);
        const projectB = projectsByPath.get(b.path) ?? projectsByName.get(b.name);
        const ta = projectActivityForProvider(projectA, selectedProvider) ?? a.createdAt;
        const tb = projectActivityForProvider(projectB, selectedProvider) ?? b.createdAt;
        return new Date(tb).getTime() - new Date(ta).getTime();
      }),
    [workspaces, projectsByName, projectsByPath, selectedProvider],
  );

  const sortedNonWorkspaceProjects = useMemo(() => {
    return projects
      .filter(
        (p) => !workspaceNames.has(p.name ?? "") && projectSupportsProvider(p, selectedProvider),
      )
      .sort((a, b) => {
        const ta = projectActivityForProvider(a, selectedProvider) ?? "";
        const tb = projectActivityForProvider(b, selectedProvider) ?? "";
        return new Date(tb).getTime() - new Date(ta).getTime();
      });
  }, [projects, workspaceNames, selectedProvider]);

  const handleAddSession = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (!selectedProvider) setSelectedProvider("claude");
      navigate("/new-session");
      if (!isDesktop) onClose();
    },
    [setSelectedProjectId, setSelectedProvider, selectedProvider, navigate, isDesktop, onClose],
  );

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

  // ─── Resize drag handle ─────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = expandedWidth;
      let currentWidth = startWidth;

      const onMouseMove = (ev: MouseEvent) => {
        currentWidth = Math.min(
          Math.max(startWidth + ev.clientX - startX, SIDEBAR_WIDTH_MIN),
          SIDEBAR_WIDTH_MAX,
        );
        // Direct DOM write — no React re-render, instant feedback.
        onDragMove(currentWidth);
      };

      const onMouseUp = () => {
        // Single React re-render to persist the final value.
        onDragEnd(currentWidth);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [expandedWidth, onDragMove, onDragEnd],
  );

  // ─── Positioning ─────────────────────────────────────────────────────────────
  //
  // Desktop: position sticky — the sidebar lives inside the CSS Grid cell
  //   and sticks to the top of the viewport. No explicit width needed; the
  //   grid track controls the rendered width so sidebar + content are always
  //   derived from the same single value.
  //
  // Mobile: position fixed — full-screen drawer that overlays content.

  const positionClass = isDesktop ? "sticky top-0 h-screen" : "fixed left-0 top-0 h-full z-50";

  const mobileVisibility = !isDesktop
    ? isOpen
      ? "translate-x-0 opacity-100 pointer-events-auto"
      : "-translate-x-full opacity-0 pointer-events-none"
    : "";

  const mobileStyle = !isDesktop
    ? {
        width: COLLAPSED_WIDTH * 4, // fixed drawer width on mobile
        transition: "transform 220ms ease-in-out, opacity 220ms ease-in-out",
      }
    : undefined;

  return (
    <aside
      className={`${positionClass} flex flex-col px-3 py-3 bg-surface-container-low border-r border-outline-variant/15 overflow-hidden ${mobileVisibility}`}
      style={mobileStyle}
    >
      {/* Brand / collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        className={`mb-4 w-full rounded-[20px] transition-all duration-200 hover:bg-surface-container flex items-center ${
          isCollapsed ? "justify-center px-0 py-2.5" : "justify-start px-3 py-2.5"
        }`}
      >
        {isCollapsed ? (
          <span className="flex shrink-0 items-center justify-center text-on-surface-variant">
            <PanelLeftOpen className="w-5 h-5" />
          </span>
        ) : (
          <div className="min-w-0 text-left">
            <h1 className="font-serif text-[1.25rem] font-bold leading-none text-primary">
              ScholarAIO
            </h1>
          </div>
        )}
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
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
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

      {/* Workspace + Project session groups (only when expanded) */}
      {!isCollapsed ? (
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1 border-t border-outline-variant/10 pt-3 transition-all duration-200"
          style={{
            opacity: projectsVisible ? 1 : 0,
            transform: projectsVisible ? "translateY(0)" : "translateY(4px)",
          }}
        >
          {sortedWorkspaces.length > 0 ? (
            <SidebarSection title="Workspaces" count={sortedWorkspaces.length}>
              {sortedWorkspaces.map((ws) => {
                const projectId = toUrlProjectId(ws.path);
                return (
                  <SidebarGroup
                    key={ws.id}
                    projectId={projectId}
                    name={ws.name}
                    icon={FolderOpen}
                    sessionId={sessionId}
                    isDesktop={isDesktop}
                    onClose={onClose}
                    onAddSession={handleAddSession}
                    provider={selectedProvider}
                    loadGroup={loadGroup}
                    getGroup={getGroup}
                  />
                );
              })}
            </SidebarSection>
          ) : null}

          {sortedNonWorkspaceProjects.length > 0 ? (
            <SidebarSection title="Projects" count={sortedNonWorkspaceProjects.length}>
              {sortedNonWorkspaceProjects.map((p) => {
                const name = p.name ?? p.path.split("/").pop() ?? p.id;
                return (
                  <SidebarGroup
                    key={p.id}
                    projectId={p.id}
                    name={name}
                    icon={FolderKanban}
                    sessionId={sessionId}
                    isDesktop={isDesktop}
                    onClose={onClose}
                    onAddSession={handleAddSession}
                    provider={selectedProvider}
                    loadGroup={loadGroup}
                    getGroup={getGroup}
                  />
                );
              })}
            </SidebarSection>
          ) : null}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* User profile + settings popup */}
      <div className="mt-3 pt-3 border-t border-outline-variant/10 relative" ref={userMenuRef}>
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

        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className={`w-full rounded-[20px] bg-surface-container transition-all duration-200 hover:bg-surface-container-high ${
            isCollapsed ? "flex justify-center py-2" : "flex items-center gap-3 px-3 py-3"
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

      {/* Resize drag handle — desktop, expanded only */}
      {isDesktop && !isCollapsed ? (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
      ) : null}
    </aside>
  );
}

export { compactLabel };
