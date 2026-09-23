import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Pencil,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { libraryApi, newSessionUrl, sessionApi } from "../../core/library";

import { usePageTitle } from "../components/NavigationLayout";

export function ProjectsPage() {
  const { setTitle } = usePageTitle();
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["library", "projects"],
    queryFn: ({ signal }) => libraryApi.projects(signal),
    select: (data) => data.projects,
  });

  const addProject = useMutation({
    mutationFn: (newPath: string) => libraryApi.createProject(newPath),
    onSuccess: () => {
      setPath("");
      queryClient.invalidateQueries({ queryKey: ["library", "projects"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to add project");
    },
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
    setTitle("Projects");
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    setError("");
    addProject.mutate(trimmed);
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Add project form */}
      <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-secondary-container rounded-xl text-primary">
            <FolderPlus className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-serif text-xl font-bold">新建文献项目</h4>
            <p className="text-xs text-on-surface-variant font-sans">
              创建内部文献项目，组织论文与会话
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="项目名称"
            aria-label="项目名称"
            maxLength={120}
            className="min-w-0 flex-1 bg-surface-container border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/40 transition-colors"
          />
          <button
            type="submit"
            disabled={addProject.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-medium border-0 cursor-pointer hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50"
          >
            <FolderPlus className="w-4 h-4" />
            创建
          </button>
          <button
            type="button"
            onClick={() => projectsQuery.refetch()}
            title="刷新项目"
            aria-label="刷新项目"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/15 text-on-surface-variant border-0 cursor-pointer hover:bg-surface-container-high transition-colors shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </form>
        {displayError ? (
          <p role="alert" className="mt-3 text-sm text-error">
            {displayError}
          </p>
        ) : null}
      </div>

      {/* Project list */}
      <div className="space-y-3">
        {loading && projects.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-on-surface-variant/60 px-2">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            Loading projects…
          </div>
        ) : null}

        {!loading && projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-on-surface-variant/50">
            <FolderOpen className="w-10 h-10 opacity-30" />
            <p className="text-sm">No projects yet. Add one above.</p>
          </div>
        ) : null}

        {projects.map((project) => (
          <div
            key={project.id}
            className="flex items-center gap-4 bg-surface-container-low rounded-[1.5rem] px-6 py-5 border border-outline-variant/10 hover:border-outline-variant/20 hover:bg-surface-container transition-colors group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-secondary-container text-primary shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm text-on-surface truncate">
                <Link to={`/library?project=${encodeURIComponent(project.id)}`}>
                  {project.name}
                </Link>
              </p>
              <p className="text-[11px] font-mono text-on-surface-variant/60 truncate mt-0.5">
                {project.paperCount} 篇文献
              </p>
            </div>
            <Link to={newSessionUrl(project.id)} className="text-xs text-primary shrink-0">
              新会话
            </Link>
            <div className="flex items-center gap-4 shrink-0 text-on-surface-variant/60">
              <Link
                to={`/agents?project=${encodeURIComponent(project.id)}`}
                className="flex items-center gap-1.5"
                title="项目会话"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">{project.sessionCount}</span>
              </Link>
              {project.activeOwnedCount > 0 ? (
                <div className="flex items-center gap-1 text-primary" title="Active sessions">
                  <Zap className="w-3.5 h-3.5 fill-primary/20" />
                  <span className="text-[11px] font-mono">{project.activeOwnedCount}</span>
                </div>
              ) : null}
              <button
                type="button"
                title="重命名项目"
                aria-label={`重命名 ${project.name}`}
                disabled={renameProject.isPending}
                className="cursor-pointer border-0 bg-transparent p-0 text-on-surface-variant/60 hover:text-on-surface disabled:opacity-50"
                onClick={() => {
                  const name = window.prompt("新的项目名称", project.name)?.trim();
                  if (name && name !== project.name) renameProject.mutate({ id: project.id, name });
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="归档项目"
                aria-label={`归档 ${project.name}`}
                disabled={archiveProject.isPending}
                className="cursor-pointer border-0 bg-transparent p-0 text-on-surface-variant/60 hover:text-error disabled:opacity-50"
                onClick={() => {
                  const warning = project.sessionCount
                    ? `归档「${project.name}」？${project.sessionCount} 个会话将解除项目关联，之后在各自目录中继续。`
                    : `归档「${project.name}」？目录会移入回收区，可在数据目录中找回。`;
                  if (window.confirm(warning)) archiveProject.mutate(project.id);
                }}
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
