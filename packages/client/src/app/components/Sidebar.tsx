import type { StoredSession } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderCog,
  FolderOpen,
  Library,
  Loader2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  matchPath,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { libraryApi, workspaceUrl } from "../../core/library";
import {
  isSessionActive,
  newSessionUrl,
  sessionApi,
  sessionQuery,
  sessionUrl,
  sessionsQuery,
} from "../../core/sessions";
import { LibraryActivityTray } from "../../features/library/components/LibraryActivityTray";
import { WorkspaceCreateDialog } from "../../features/library/components/WorkspaceCreateDialog";
import { SessionContextMenu } from "./SessionContextMenu";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "今天";
  if (days < 7) return `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return `${Math.floor(days / 30)}月前`;
}

function SidebarSection({
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center gap-1 mb-0.5 group/section">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center justify-between px-2 py-1 rounded-lg hover:bg-surface-container transition-colors"
        >
          <span className="text-[9.5px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors truncate">
            {title}
          </span>
          <span className="min-w-[16px] text-center text-[9.5px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors">
            {count}
          </span>
        </button>
        {action}
      </div>
      {open ? children : null}
    </div>
  );
}

interface SidebarProps {
  isDesktop: boolean;
  isCollapsed: boolean;
  isOpen: boolean;
  width: number;
  /** `persist` is false while dragging: only where the drag ends is saved. */
  onWidthChange: (width: number, persist?: boolean) => void;
  onResizingChange: (resizing: boolean) => void;
  onToggle: () => void;
  onClose: () => void;
}

/** Width of the collapsed rail, and the icon column every row shares with it. */
export const SIDEBAR_WIDTH_COLLAPSED = 60;

export function Sidebar({
  isDesktop,
  isCollapsed,
  isOpen,
  width,
  onWidthChange,
  onResizingChange,
  onToggle,
  onClose,
}: SidebarProps) {
  const sessions = useQuery(sessionsQuery);
  const projects = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
  });
  const [params] = useSearchParams();
  const location = useLocation();
  const { sessionId } = useParams();
  const scopedProject = matchPath("/workspaces/:projectId", location.pathname)?.params.projectId;
  const activeProject =
    scopedProject ??
    params.get("project") ??
    sessions.data?.sessions.find((session) => session.id === sessionId)?.projectId;
  const grouped = useMemo(() => {
    const groups = new Map<string, StoredSession[]>();
    for (const session of sessions.data?.sessions ?? []) {
      const id = session.projectId ?? "";
      const group = groups.get(id) ?? [];
      group.push(session);
      groups.set(id, group);
    }
    return groups;
  }, [sessions.data]);
  const known = new Set(projects.data?.projects.map((p) => p.id));
  const unassigned = [...grouped.entries()]
    .filter(([id]) => !known.has(id))
    .flatMap(([, items]) => items);
  const collapsed = isDesktop && isCollapsed;
  const close = isDesktop ? undefined : onClose;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sectionOpen, setSectionOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ session: StoredSession; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The user just chose to rename a session: its name field takes the focus.
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) renameInput.current?.focus();
  }, [renaming]);
  const settled = (id: string) => {
    void client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
    void client.invalidateQueries({ queryKey: sessionQuery(id).queryKey });
  };
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => sessionApi.rename(id, title),
    onSettled: (_data, _error, { id }) => settled(id),
  });
  const fork = useMutation({
    mutationFn: (id: string) => sessionApi.fork(id),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
      close?.();
      navigate(sessionUrl(created.id));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => sessionApi.remove(id),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: sessionQuery(id).queryKey });
      void client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
      if (sessionId === id) navigate("/sessions");
    },
  });
  const actionError = rename.error ?? fork.error ?? remove.error;
  const commitRename = (session: StoredSession, value: string) => {
    setRenaming(null);
    const title = value.trim();
    if (title && title !== session.title) rename.mutate({ id: session.id, title });
  };
  useEffect(() => {
    if (activeProject) setExpanded((previous) => new Set([...previous, activeProject]));
  }, [activeProject]);

  // Pointer moves arrive faster than frames; apply the latest once per frame.
  const drag = useRef<{ frame: number; x: number } | null>(null);
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );
  const endDrag = (x: number) => {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onWidthChange(x, true);
    onResizingChange(false);
  };

  // Every row keeps its icon in the rail's column, so collapsing only hides
  // the labels: nothing moves sideways while the width animates.
  const label = (text: string) => (
    <span
      className={`min-w-0 truncate whitespace-nowrap transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}
    >
      {text}
    </span>
  );
  const navClass = (active: boolean) =>
    `w-full flex items-center gap-2.5 rounded-lg px-[11px] py-2 text-[12.5px] font-medium transition-colors ${active ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"}`;
  const renderSessions = (items: StoredSession[]) =>
    items.map((session) =>
      renaming === session.id ? (
        <input
          key={session.id}
          ref={renameInput}
          aria-label="会话名称"
          defaultValue={session.title}
          maxLength={200}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => commitRename(session, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename(session, event.currentTarget.value);
            else if (event.key === "Escape") setRenaming(null);
          }}
          className="w-full rounded-lg border border-primary/40 bg-surface-container-lowest px-2.5 py-1 text-[12px] text-on-surface outline-none"
        />
      ) : (
        <NavLink
          key={session.id}
          to={sessionUrl(session.id)}
          onClick={close}
          className={({ isActive }) =>
            `group flex items-center justify-between w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isActive ? "bg-surface-container-high text-primary" : "text-on-surface hover:bg-surface-container"}`
          }
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ session, x: event.clientX, y: event.clientY });
          }}
        >
          <span className="line-clamp-1 text-[12px] min-w-0 flex-1">{session.title}</span>
          <span className="flex items-center gap-1.5 shrink-0 ml-2">
            {isSessionActive(session.state) ? (
              <span
                aria-label="进行中"
                className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
              />
            ) : null}
            <span
              className="text-[9.5px] text-on-surface-variant/60 whitespace-nowrap"
              title={new Date(session.updatedAt).toLocaleString()}
            >
              {relativeTime(session.updatedAt)}
            </span>
          </span>
        </NavLink>
      ),
    );
  const libraryActive = location.pathname.startsWith("/library") && !scopedProject;
  return (
    <>
      {!isDesktop && !isOpen ? (
        <button
          className="fixed top-2 left-2 z-40 hub-button"
          type="button"
          aria-label="打开导航"
          onClick={onToggle}
        >
          <Menu size={18} />
        </button>
      ) : null}
      <aside
        aria-label="工作台导航"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isDesktop) onClose();
        }}
        className={`${isDesktop ? "sticky top-0" : "fixed top-0 left-0 z-50 w-72 max-w-[85vw]"} h-dvh overflow-hidden bg-surface-container-low border-r border-outline-variant/15 ${!isOpen ? "hidden" : ""}`}
      >
        {/* Laid out at its full width even while the column animates, so the
            column reveals it instead of reflowing it every frame. */}
        <div
          className="flex h-full flex-col py-3 px-2.5"
          style={isDesktop ? { width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : width } : undefined}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "展开导航" : "收起导航"}
            title={collapsed ? "展开导航" : "收起导航"}
            className="group/brand mb-3 flex w-full items-center gap-2.5 rounded-xl px-[11px] py-2 transition-colors hover:bg-surface-container"
          >
            {collapsed ? (
              <PanelLeftOpen
                size={16}
                className="shrink-0 text-on-surface-variant"
                aria-hidden="true"
              />
            ) : (
              <PanelLeftClose
                size={16}
                className="shrink-0 text-on-surface-variant/60 group-hover/brand:text-on-surface-variant"
                aria-hidden="true"
              />
            )}
            <span
              className={`font-serif text-[1.1rem] font-bold leading-none text-primary whitespace-nowrap transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}
            >
              ScholarAIO
            </span>
          </button>
          <NavLink
            onClick={close}
            className="mb-2.5 flex w-full items-center gap-2.5 rounded-xl bg-surface-container px-[11px] py-2 text-[12.5px] font-medium text-on-surface transition-colors hover:bg-surface-container-high"
            aria-label="新对话"
            title="新对话"
            to={newSessionUrl(activeProject)}
          >
            <Plus size={16} className="shrink-0" aria-hidden="true" />
            {label("New Chat")}
          </NavLink>
          <nav aria-label="主导航" className="space-y-1 mb-4 shrink-0">
            <NavLink
              onClick={close}
              className={() => navClass(libraryActive)}
              aria-label="文献库"
              title="文献库"
              to="/library"
            >
              <Library size={16} className="shrink-0" aria-hidden="true" />
              {label("Library")}
            </NavLink>
            <NavLink
              onClick={close}
              className={({ isActive }) => navClass(isActive)}
              aria-label="Skills"
              title="Skills"
              to="/skills"
            >
              <Sparkles size={16} className="shrink-0" aria-hidden="true" />
              {label("Skills")}
            </NavLink>
          </nav>
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-outline-variant/15 pt-2.5">
            {!collapsed ? (
              <>
                <SidebarSection
                  title="Workspaces"
                  count={projects.data?.projects.length ?? 0}
                  open={sectionOpen}
                  onToggle={() => setSectionOpen((v) => !v)}
                  action={
                    <>
                      <button
                        type="button"
                        aria-label="新建 Workspace"
                        title="新建 Workspace"
                        onClick={() => setCreating(true)}
                        className="shrink-0 p-1 rounded-md opacity-0 group-hover/section:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <Link
                        to="/projects"
                        aria-label="管理 Workspace"
                        title="管理 Workspace"
                        onClick={close}
                        className="shrink-0 p-1 rounded-md opacity-0 group-hover/section:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                      >
                        <FolderCog className="w-3 h-3" />
                      </Link>
                    </>
                  }
                >
                  {projects.isLoading ? (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-on-surface-variant/60">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-[11.5px]">加载中…</span>
                    </div>
                  ) : null}
                  {projects.data?.projects.map((project) => (
                    <div key={project.id} className="mb-0.5">
                      <div className="flex items-center gap-1 group/header">
                        <button
                          type="button"
                          aria-expanded={expanded.has(project.id)}
                          onClick={() =>
                            setExpanded((previous) => {
                              const next = new Set(previous);
                              if (next.has(project.id)) next.delete(project.id);
                              else next.add(project.id);
                              return next;
                            })
                          }
                          aria-current={activeProject === project.id ? "true" : undefined}
                          className={`flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-lg transition-colors text-left ${activeProject === project.id ? "bg-surface-container-high text-primary" : "text-on-surface hover:bg-surface-container"}`}
                        >
                          <FolderOpen
                            className={`w-3.5 h-3.5 shrink-0 ${activeProject === project.id ? "text-primary" : "text-on-surface-variant"}`}
                          />
                          <span className="text-[12px] font-medium truncate">{project.name}</span>
                        </button>
                        <Link
                          to={newSessionUrl(project.id)}
                          onClick={close}
                          title={`在 ${project.name} 中新建会话`}
                          aria-label={`在 ${project.name} 中新建会话`}
                          className="shrink-0 p-1 rounded-md opacity-0 group-hover/header:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                        >
                          <Plus className="w-3 h-3" />
                        </Link>
                      </div>
                      {expanded.has(project.id) ? (
                        <div className="ml-4 mt-0.5 space-y-0.5">
                          <Link
                            className={`flex items-center justify-between w-full rounded-lg px-2.5 py-1.5 text-[11.5px] transition-colors ${scopedProject === project.id ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:bg-surface-container hover:text-primary"}`}
                            onClick={close}
                            to={workspaceUrl(project.id)}
                          >
                            <span>文献</span>
                            <span className="text-[9.5px] font-mono tabular-nums">
                              {project.paperCount}
                            </span>
                          </Link>
                          {renderSessions(grouped.get(project.id) ?? [])}
                          {!grouped.get(project.id)?.length ? (
                            <p className="px-2.5 py-1 text-[11.5px] text-on-surface-variant/50">
                              暂无对话
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {projects.data?.projects.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11.5px] text-on-surface-variant/50">
                      还没有文献项目
                    </p>
                  ) : null}
                </SidebarSection>
                {unassigned.length ? (
                  <SidebarSection
                    title="未归属会话"
                    count={unassigned.length}
                    open={unassignedOpen}
                    onToggle={() => setUnassignedOpen((v) => !v)}
                  >
                    <div className="space-y-0.5">{renderSessions(unassigned)}</div>
                  </SidebarSection>
                ) : null}
                {(projects.error ?? sessions.error ?? actionError) ? (
                  <p role="alert" className="text-error text-xs p-2 break-words">
                    {(projects.error ?? sessions.error ?? actionError)?.message}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="pt-2.5 mt-2 border-t border-outline-variant/15 shrink-0">
            <LibraryActivityTray collapsed={collapsed} />
            <NavLink
              onClick={close}
              className={({ isActive }) => navClass(isActive)}
              aria-label="设置"
              title="设置"
              to="/settings"
            >
              <Settings size={16} className="shrink-0" aria-hidden="true" />
              {label("Settings")}
            </NavLink>
          </div>
        </div>
        {isDesktop && !collapsed ? (
          <input
            type="range"
            aria-label="侧边栏宽度"
            min={220}
            max={420}
            step={1}
            value={width}
            onChange={(e) => onWidthChange(Number(e.target.value))}
            className="sr-only focus:not-sr-only focus:w-full accent-primary"
          />
        ) : null}
        {isDesktop && !collapsed ? (
          <button
            type="button"
            aria-label="拖动调整侧边栏宽度"
            title="拖动调整宽度；也可使用下方滑块"
            className="absolute right-0 inset-y-0 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-primary/20 active:bg-primary/30"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { frame: 0, x: e.clientX };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              onResizingChange(true);
            }}
            onPointerMove={(e) => {
              const state = drag.current;
              if (!state || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
              state.x = e.clientX;
              if (state.frame) return;
              state.frame = requestAnimationFrame(() => {
                state.frame = 0;
                onWidthChange(state.x, false);
              });
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              endDrag(e.clientX);
            }}
            onPointerCancel={(e) => endDrag(e.clientX)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                onWidthChange(width + (e.key === "ArrowRight" ? 10 : -10));
              }
            }}
          />
        ) : null}
      </aside>
      {creating ? <WorkspaceCreateDialog onClose={() => setCreating(false)} /> : null}
      {menu ? (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menu.session.id)}
          forkDisabled={isSessionActive(menu.session.state) || menu.session.readOnly}
          onFork={() => fork.mutate(menu.session.id)}
          onDelete={() => {
            // Irreversible: the conversation and its private files go.
            if (window.confirm(`删除会话「${menu.session.title}」？此操作无法撤销。`))
              remove.mutate(menu.session.id);
          }}
        />
      ) : null}
    </>
  );
}
