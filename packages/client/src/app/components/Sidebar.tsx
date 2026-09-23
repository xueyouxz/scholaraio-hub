import type { StoredSession } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import {
  FolderCog,
  FolderOpen,
  Library,
  Loader2,
  Menu,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { libraryApi, newSessionUrl, sessionApi } from "../../core/library";
import { LibraryActivityTray } from "../../features/library/components/LibraryActivityTray";
import { WorkspaceCreateDialog } from "../../features/library/components/WorkspaceCreateDialog";

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
    <div className="mb-3">
      <div className="flex items-center gap-1 mb-0.5 group/section">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
        >
          <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors truncate">
            {title}
          </span>
          <span className="min-w-[18px] text-center text-[10px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant/50 group-hover/section:text-on-surface-variant/70 transition-colors">
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
  onWidthChange: (width: number) => void;
  onToggle: () => void;
  onClose: () => void;
}

export function Sidebar({
  isDesktop,
  isCollapsed,
  isOpen,
  width,
  onWidthChange,
  onToggle,
  onClose,
}: SidebarProps) {
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => sessionApi.list(signal),
  });
  const projects = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
  });
  const [params] = useSearchParams();
  const { sessionId } = useParams();
  const activeProject =
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
  useEffect(() => {
    if (activeProject) setExpanded((previous) => new Set([...previous, activeProject]));
  }, [activeProject]);
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `w-full flex items-center rounded-xl transition-colors text-[13px] font-medium ${collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"} ${isActive ? "bg-surface-container-high text-primary border-l-4 border-primary" : "text-on-surface-variant hover:bg-surface-container"}`;
  const renderSessions = (items: StoredSession[]) =>
    items.map((session) => (
      <NavLink
        key={session.id}
        to={`/sessions/${session.id}`}
        onClick={close}
        className={({ isActive }) =>
          `group flex items-center justify-between w-full rounded-xl px-3 py-1.5 text-left transition-colors ${isActive ? "bg-surface-container text-primary" : "text-on-surface hover:bg-surface-container"}`
        }
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 32px" }}
      >
        <span className="line-clamp-1 text-[13px] min-w-0 flex-1">{session.title}</span>
        <span className="flex items-center gap-1.5 shrink-0 ml-2">
          {session.state === "running" || session.state === "waiting-input" ? (
            <span
              aria-label="进行中"
              className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
            />
          ) : null}
          <span
            className="text-[10px] text-on-surface-variant/60 whitespace-nowrap"
            title={new Date(session.updatedAt).toLocaleString()}
          >
            {relativeTime(session.updatedAt)}
          </span>
        </span>
      </NavLink>
    ));
  return (
    <>
      {!isDesktop && !isOpen ? (
        <button
          className="fixed top-2 left-2 z-40 hub-button"
          type="button"
          aria-label="打开导航"
          onClick={onToggle}
        >
          <Menu size={20} />
        </button>
      ) : null}
      <aside
        aria-label="工作台导航"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isDesktop) onClose();
        }}
        className={`${isDesktop ? "sticky top-0" : "fixed top-0 left-0 z-50 w-72 max-w-[85vw]"} h-dvh bg-surface-container-low border-r border-outline-variant/15 flex flex-col p-3 ${!isOpen ? "hidden" : ""}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "展开导航" : "收起导航"}
          className={`mb-4 w-full rounded-[20px] transition-colors hover:bg-surface-container flex items-center py-2.5 ${collapsed ? "justify-center" : "px-3"}`}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <span className="font-serif text-[1.25rem] font-bold leading-none text-primary">
              ScholarAIO
            </span>
          )}
        </button>
        <NavLink
          onClick={close}
          className={`mb-3 flex items-center bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors ${collapsed ? "justify-center w-8 h-8 rounded-xl mx-auto" : "w-full gap-2.5 rounded-[18px] px-3 py-2.5 text-sm font-medium"}`}
          aria-label="新对话"
          to={newSessionUrl(activeProject)}
        >
          <Plus size={16} aria-hidden="true" />
          {!collapsed ? "New Chat" : null}
        </NavLink>
        <nav aria-label="主导航" className="space-y-1.5 mb-5 shrink-0">
          <NavLink onClick={close} className={navClass} aria-label="文献库" to="/library">
            <Library size={20} aria-hidden="true" />
            {!collapsed ? "Library" : null}
          </NavLink>
          <NavLink onClick={close} className={navClass} aria-label="Skills" to="/skills">
            <Sparkles size={20} aria-hidden="true" />
            {!collapsed ? "Skills" : null}
          </NavLink>
        </nav>
        <div className="flex-1 min-h-0 overflow-y-auto border-t border-outline-variant/15 pt-3">
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
                      className="shrink-0 p-1 rounded-lg opacity-0 group-hover/section:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary border-0 bg-transparent cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <Link
                      to="/projects"
                      aria-label="管理 Workspace"
                      title="管理 Workspace"
                      onClick={close}
                      className="shrink-0 p-1 rounded-lg opacity-0 group-hover/section:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                    >
                      <FolderCog className="w-3.5 h-3.5" />
                    </Link>
                  </>
                }
              >
                {projects.isLoading ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-on-surface-variant/60">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span className="text-[12px]">加载中…</span>
                  </div>
                ) : null}
                {projects.data?.projects.map((project) => (
                  <div key={project.id} className="mb-1">
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
                        className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-lg hover:bg-surface-container transition-colors text-left"
                      >
                        <FolderOpen className="w-4 h-4 shrink-0 text-on-surface-variant" />
                        <span className="text-[12px] font-medium text-on-surface truncate">
                          {project.name}
                        </span>
                      </button>
                      <Link
                        to={newSessionUrl(project.id)}
                        onClick={close}
                        title={`在 ${project.name} 中新建会话`}
                        aria-label={`在 ${project.name} 中新建会话`}
                        className="shrink-0 p-1 rounded-lg opacity-0 group-hover/header:opacity-100 focus:opacity-100 hover:bg-surface-container transition-all text-on-surface-variant hover:text-primary"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                    {expanded.has(project.id) ? (
                      <div className="ml-5 mt-0.5 space-y-0.5">
                        <Link
                          className="flex items-center justify-between w-full rounded-xl px-3 py-1.5 text-[12px] text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors"
                          onClick={close}
                          to={`/library?project=${encodeURIComponent(project.id)}`}
                        >
                          <span>文献</span>
                          <span className="text-[10px] font-mono tabular-nums">
                            {project.paperCount}
                          </span>
                        </Link>
                        {renderSessions(grouped.get(project.id) ?? [])}
                        {!grouped.get(project.id)?.length ? (
                          <p className="px-3 py-1.5 text-[12px] text-on-surface-variant/50">
                            暂无对话
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {projects.data?.projects.length === 0 ? (
                  <p className="px-3 py-1.5 text-[12px] text-on-surface-variant/50">
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
              {(projects.error ?? sessions.error) ? (
                <p role="alert" className="text-error text-xs p-2 break-words">
                  {(projects.error ?? sessions.error)?.message}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="pt-3 mt-2 border-t border-outline-variant/15 shrink-0">
          <LibraryActivityTray collapsed={collapsed} />
          <NavLink onClick={close} className={navClass} aria-label="设置" to="/settings">
            <Settings size={20} aria-hidden="true" />
            {!collapsed ? "Settings" : null}
          </NavLink>
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
            className="absolute right-0 inset-y-0 w-1 cursor-col-resize touch-none hover:bg-primary/20"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) onWidthChange(e.clientX);
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
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
    </>
  );
}
