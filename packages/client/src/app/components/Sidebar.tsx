import type { ProjectSummary, SessionSummary } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  FolderTree,
  Library,
  Loader2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { PROJECTS_KEY, UNASSIGNED, projectSessionsQuery, projectsQuery } from "../../core/projects";
import { newSessionUrl, sessionApi, sessionQuery, sessionUrl } from "../../core/sessions";
import { LibraryActivityTray } from "../../features/library/components/LibraryActivityTray";
import { ResizeHandle } from "../../shared/ui/ResizeHandle";
import { SessionContextMenu } from "./SessionContextMenu";
import { SessionRow } from "./SessionRow";

/** How many sessions a project shows at first, and how many more each "more" adds. */
const PAGE = 8;
/** How many projects the sidebar lists; the projects page has them all. */
const PROJECT_LIMIT = 12;

function SidebarSection({
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  title: string;
  /** Shown beside the title, when known. */
  count?: number;
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
          {count === undefined ? null : (
            <span className="min-w-[16px] text-center text-[9.5px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors">
              {count}
            </span>
          )}
        </button>
        {action}
      </div>
      {open ? children : null}
    </div>
  );
}

/** What the sidebar does with a session a row's menu or rename field names. */
interface SessionHandlers {
  renaming: string | null;
  onMenu: (session: SessionSummary, x: number, y: number) => void;
  onRename: (session: SessionSummary, title: string) => void;
  onCancelRename: () => void;
  onOpen?: () => void;
}

/** A project's newest sessions (or those in no project), loaded when shown, more on request. */
function SessionList({ project, handlers }: { project: string; handlers: SessionHandlers }) {
  const [limit, setLimit] = useState(PAGE);
  const page = useQuery(projectSessionsQuery(project, limit));
  if (page.isLoading)
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-on-surface-variant/60">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="text-[11.5px]">加载中…</span>
      </div>
    );
  if (page.error)
    return (
      <p role="alert" className="px-2.5 py-1 text-[11.5px] text-error break-words">
        {page.error.message}
      </p>
    );
  const sessions = page.data?.sessions ?? [];
  return (
    <div className="space-y-0.5">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          renaming={handlers.renaming === session.id}
          onRename={(title) => handlers.onRename(session, title)}
          onCancelRename={handlers.onCancelRename}
          onMenu={(x, y) => handlers.onMenu(session, x, y)}
          onOpen={handlers.onOpen}
        />
      ))}
      {sessions.length === 0 ? (
        <p className="px-2.5 py-1 text-[11.5px] text-on-surface-variant/50">暂无会话</p>
      ) : null}
      {page.data?.nextOffset !== null && page.data?.nextOffset !== undefined ? (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE)}
          className="w-full rounded-lg px-2.5 py-1 text-left text-[11px] text-on-surface-variant/70 hover:bg-surface-container hover:text-on-surface transition-colors"
        >
          显示更多
        </button>
      ) : null}
    </div>
  );
}

/** One project: a header that opens its sessions, and a button for a new session in it. */
function ProjectGroup({
  project,
  active,
  open,
  onToggle,
  handlers,
}: {
  project: ProjectSummary;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  handlers: SessionHandlers;
}) {
  return (
    <div className="mb-0.5">
      <div className="flex items-center gap-1 group/header">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          aria-current={active ? "true" : undefined}
          title={project.path}
          className={`flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-lg transition-colors text-left ${active ? "bg-surface-container-high text-primary" : "text-on-surface hover:bg-surface-container"}`}
        >
          <FolderOpen
            className={`w-3.5 h-3.5 shrink-0 ${active ? "text-primary" : "text-on-surface-variant"}`}
          />
          <span className="text-[12px] font-medium truncate">{project.name}</span>
        </button>
        <Link
          to={newSessionUrl({ project: project.id })}
          onClick={handlers.onOpen}
          title={`在 ${project.name} 中新建会话`}
          aria-label={`在 ${project.name} 中新建会话`}
          className="shrink-0 p-1 rounded-md opacity-0 group-hover/header:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
        >
          <Plus className="w-3 h-3" />
        </Link>
      </div>
      {open ? (
        <div className="ml-3 mt-0.5">
          <SessionList project={project.id} handlers={handlers} />
        </div>
      ) : null}
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
  const projects = useQuery(projectsQuery);
  const [params] = useSearchParams();
  const location = useLocation();
  const sessionId = matchPath("/sessions/:sessionId", location.pathname)?.params.sessionId;
  const current = useQuery({ ...sessionQuery(sessionId ?? ""), enabled: !!sessionId });
  const pageProject = matchPath("/projects/:projectId", location.pathname)?.params.projectId;
  const activeProject = pageProject ?? params.get("project") ?? current.data?.projectId;
  const collapsed = isDesktop && isCollapsed;
  const close = isDesktop ? undefined : onClose;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ session: SessionSummary; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const settled = (id: string) => {
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
    void client.invalidateQueries({ queryKey: sessionQuery(id).queryKey });
  };
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => sessionApi.update(id, { title }),
    onSettled: (_data, _error, { id }) => settled(id),
  });
  const fork = useMutation({
    mutationFn: (id: string) => sessionApi.fork(id),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: PROJECTS_KEY });
      close?.();
      navigate(sessionUrl(created.id));
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => sessionApi.update(id, { archived: true }),
    onSuccess: (_data, id) => {
      settled(id);
      if (sessionId === id) navigate("/sessions");
    },
  });
  const actionError = rename.error ?? fork.error ?? archive.error;
  const handlers: SessionHandlers = {
    renaming,
    onMenu: (session, x, y) => setMenu({ session, x, y }),
    onRename: (session, value) => {
      setRenaming(null);
      const title = value.trim();
      if (title && title !== session.title) rename.mutate({ id: session.id, title });
    },
    onCancelRename: () => setRenaming(null),
    onOpen: close,
  };
  useEffect(() => {
    if (activeProject) setExpanded((previous) => new Set([...previous, activeProject]));
  }, [activeProject]);
  const listed = projects.data?.projects ?? [];
  // The active project stays listed even when it is not among the most recent.
  const shown = listed.filter(
    (project, index) => index < PROJECT_LIMIT || project.id === activeProject,
  );

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
  const failure = projects.error ?? actionError;
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
            to={newSessionUrl({ project: activeProject })}
          >
            <Plus size={16} className="shrink-0" aria-hidden="true" />
            {label("New Chat")}
          </NavLink>
          <nav aria-label="主导航" className="space-y-1 mb-4 shrink-0">
            <NavLink
              onClick={close}
              end
              className={({ isActive }) => navClass(isActive)}
              aria-label="项目"
              title="项目"
              to="/projects"
            >
              <FolderTree size={16} className="shrink-0" aria-hidden="true" />
              {label("Projects")}
            </NavLink>
            <NavLink
              onClick={close}
              className={({ isActive }) => navClass(isActive)}
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
                  title="项目"
                  count={listed.length}
                  open={projectsOpen}
                  onToggle={() => setProjectsOpen((v) => !v)}
                  action={
                    <Link
                      to="/projects"
                      aria-label="全部项目"
                      title="全部项目"
                      onClick={close}
                      className="shrink-0 p-1 rounded-md opacity-0 group-hover/section:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                    >
                      <FolderTree className="w-3 h-3" />
                    </Link>
                  }
                >
                  {projects.isLoading ? (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-on-surface-variant/60">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-[11.5px]">加载中…</span>
                    </div>
                  ) : null}
                  {shown.map((project) => (
                    <ProjectGroup
                      key={project.id}
                      project={project}
                      active={activeProject === project.id}
                      open={expanded.has(project.id)}
                      onToggle={() =>
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (next.has(project.id)) next.delete(project.id);
                          else next.add(project.id);
                          return next;
                        })
                      }
                      handlers={handlers}
                    />
                  ))}
                  {listed.length > shown.length ? (
                    <Link
                      to="/projects"
                      onClick={close}
                      className="block px-2.5 py-1 text-[11px] text-on-surface-variant/70 hover:text-primary"
                    >
                      全部 {listed.length} 个项目
                    </Link>
                  ) : null}
                  {projects.data && listed.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11.5px] text-on-surface-variant/50">
                      还没有项目会话
                    </p>
                  ) : null}
                  {projects.data?.failures.map((failed) => (
                    <p
                      key={failed.provider}
                      role="alert"
                      className="px-2.5 py-1 text-[11px] text-error break-words"
                    >
                      无法读取 {failed.provider} 的会话：{failed.message}
                    </p>
                  ))}
                </SidebarSection>
                <SidebarSection
                  title="未归属会话"
                  open={unassignedOpen}
                  onToggle={() => setUnassignedOpen((v) => !v)}
                >
                  <SessionList project={UNASSIGNED} handlers={handlers} />
                </SidebarSection>
                {failure ? (
                  <p role="alert" className="text-error text-xs p-2 break-words">
                    {failure.message}
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
          <ResizeHandle
            label="拖动调整侧边栏宽度"
            width={width}
            grow="right"
            step={10}
            onResize={onWidthChange}
            onDraggingChange={onResizingChange}
            className="absolute right-0 inset-y-0 w-1.5 hover:bg-primary/20 active:bg-primary/30"
          />
        ) : null}
      </aside>
      {menu ? (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menu.session.id)}
          forkDisabled={!!menu.session.state}
          onFork={() => fork.mutate(menu.session.id)}
          onArchive={() => archive.mutate(menu.session.id)}
        />
      ) : null}
    </>
  );
}
