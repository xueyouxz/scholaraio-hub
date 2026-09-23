import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderOpen, MessageSquare, Pencil, Plus, RefreshCw, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { libraryApi, newSessionUrl, sessionApi } from "../../core/library";
import { WorkspaceCreateDialog } from "../../features/library/components/WorkspaceCreateDialog";

import { usePageTitle } from "../components/NavigationLayout";

/** Every workspace this Hub holds, as a list rather than a wall of cards. */
export function ProjectsPage() {
  const { setTitle } = usePageTitle();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
    select: (data) => data.projects,
  });

  const renameProject = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => libraryApi.renameProject(id, name),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["library", "projects"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "重命名失败"),
  });

  const archiveProject = useMutation({
    mutationFn: (id: string) => libraryApi.archiveProject(id),
    onSuccess: ({ sessions }) => {
      setError(sessions ? `项目已归档，${sessions} 个会话已解除关联。` : "");
      queryClient.invalidateQueries({ queryKey: ["library", "projects"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "归档失败"),
  });

  useEffect(() => {
    setTitle("Workspaces");
    return () => setTitle("");
  }, [setTitle]);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => sessionApi.list(signal),
    refetchInterval: 5000,
  });
  const projects = (projectsQuery.data ?? []).map((project) => {
    const sessions =
      sessionsQuery.data?.sessions.filter((session) => session.projectId === project.id) ?? [];
    return {
      ...project,
      sessionCount: sessions.length,
      activeOwnedCount: sessions.filter(
        (session) => session.state === "running" || session.state === "waiting-input",
      ).length,
    };
  });
  const loading = projectsQuery.isLoading || projectsQuery.isFetching;
  const loadError =
    projectsQuery.error instanceof Error
      ? projectsQuery.error.message
      : projectsQuery.error
        ? "Failed to load projects"
        : "";
  const displayError = error || loadError;

  return (
    <div className="w-full max-w-2xl mx-auto pt-2 pb-6">
      <div className="flex items-center gap-2 pb-2">
        <h2 className="flex-1 min-w-0 font-serif text-lg font-semibold text-on-surface">
          Workspaces
        </h2>
        <button
          type="button"
          onClick={() => projectsQuery.refetch()}
          title="刷新"
          aria-label="刷新 Workspace 列表"
          className="flex items-center justify-center w-7 h-7 rounded-md text-on-surface-variant hover:bg-surface-container border-0 bg-transparent cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary border-0 cursor-pointer hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
      </div>

      {displayError ? (
        <p role="alert" className="py-2 text-sm text-error">
          {displayError}
        </p>
      ) : null}

      {loading && projects.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-variant/60">加载中…</p>
      ) : null}

      {!loading && projects.length === 0 ? (
        <p className="py-12 text-center text-sm text-on-surface-variant/60">
          还没有 Workspace，先新建一个。
        </p>
      ) : null}

      <ul className="divide-y divide-outline-variant/10">
        {projects.map((project) => (
          <li
            key={project.id}
            className="group flex items-center gap-3 px-2 py-2.5 hover:bg-surface-container/60"
          >
            <FolderOpen className="w-4 h-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/library?project=${encodeURIComponent(project.id)}`}
                className="block truncate text-sm text-on-surface hover:text-primary"
              >
                {project.name}
              </Link>
              <p className="truncate text-[11px] font-mono text-on-surface-variant/60">
                {project.paperCount} 篇文献
              </p>
            </div>
            <Link
              to={newSessionUrl(project.id)}
              className="shrink-0 text-xs text-primary opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              新会话
            </Link>
            <Link
              to={`/agents?project=${encodeURIComponent(project.id)}`}
              className="flex shrink-0 items-center gap-1.5 text-on-surface-variant/60"
              title="项目会话"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-[11px] font-mono tabular-nums">{project.sessionCount}</span>
            </Link>
            {project.activeOwnedCount > 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-primary" title="进行中的会话">
                <Zap className="w-4 h-4 fill-primary/20" />
                <span className="text-[11px] font-mono tabular-nums">
                  {project.activeOwnedCount}
                </span>
              </span>
            ) : null}
            <button
              type="button"
              title="重命名"
              aria-label={`重命名 ${project.name}`}
              disabled={renameProject.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-on-surface-variant/60 hover:bg-surface-container hover:text-on-surface disabled:opacity-50 cursor-pointer"
              onClick={() => {
                const name = window.prompt("新的 Workspace 名称", project.name)?.trim();
                if (name && name !== project.name) renameProject.mutate({ id: project.id, name });
              }}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="归档"
              aria-label={`归档 ${project.name}`}
              disabled={archiveProject.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-on-surface-variant/60 hover:bg-surface-container hover:text-error disabled:opacity-50 cursor-pointer"
              onClick={() => {
                const warning = project.sessionCount
                  ? `归档「${project.name}」？${project.sessionCount} 个会话将解除项目关联，之后在各自目录中继续。`
                  : `归档「${project.name}」？目录会移入回收区，可在数据目录中找回。`;
                if (window.confirm(warning)) archiveProject.mutate(project.id);
              }}
            >
              <Archive className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      {creating ? <WorkspaceCreateDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
