import type { ProjectSummary, ProviderName } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, FolderOpen, FolderPlus, Inbox, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PROJECTS_KEY,
  UNASSIGNED,
  projectApi,
  projectUrl,
  projectsQuery,
} from "../../core/projects";
import { newSessionUrl } from "../../core/sessions";
import { ProviderLogo } from "../../features/session/composer/ui/controls/ProviderLogo";
import { usePageTitle } from "../components/NavigationLayout";
import { relativeTime } from "../components/SessionRow";

/** How many sessions each agent keeps in a project, in its own mark. */
function ProviderCounts({ counts }: { counts: ProjectSummary["sessionCounts"] }) {
  const entries = Object.entries(counts) as Array<[ProviderName, number]>;
  if (entries.length === 0)
    return <span className="text-[11px] text-on-surface-variant/60">还没有会话</span>;
  return (
    <span className="flex items-center gap-2.5">
      {entries.map(([provider, count]) => (
        <span
          key={provider}
          className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-on-surface-variant"
          title={`${provider === "claude" ? "Claude Code" : "Codex"}：${count} 个会话`}
        >
          <ProviderLogo provider={provider} size={12} />
          {count}
        </span>
      ))}
    </span>
  );
}

/**
 * The home page: every project Claude Code and Codex have sessions in, most
 * recently active first, and a way to add a directory before any session ran there.
 */
export function ProjectsPage() {
  const { setTitle } = usePageTitle();
  const client = useQueryClient();
  const projects = useQuery(projectsQuery);
  const [path, setPath] = useState("");
  useEffect(() => {
    setTitle("Projects");
    return () => setTitle("");
  }, [setTitle]);
  const refresh = () => client.invalidateQueries({ queryKey: PROJECTS_KEY });
  const add = useMutation({
    mutationFn: (directory: string) => projectApi.add(directory),
    onSuccess: () => {
      setPath("");
      void refresh();
    },
  });
  const hide = useMutation({ mutationFn: projectApi.hide, onSuccess: () => void refresh() });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (path.trim()) add.mutate(path.trim());
  };
  const list = projects.data?.projects ?? [];
  const error = projects.error ?? add.error ?? hide.error;
  return (
    <div className="w-full max-w-5xl mx-auto px-6 pt-4 pb-10">
      <form onSubmit={submit} className="flex items-center gap-2 mb-5">
        <label className="flex-1 flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
          <FolderPlus className="w-4 h-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
          <span className="sr-only">项目目录的绝对路径</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="添加项目目录，例如 /Users/me/Projects/app"
            className="flex-1 min-w-0 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/60"
          />
        </label>
        <button
          type="submit"
          disabled={!path.trim() || add.isPending}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          添加
        </button>
      </form>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-error break-words">
          {error.message}
        </p>
      ) : null}
      {projects.data?.failures.map((failed) => (
        <p key={failed.provider} role="alert" className="mb-3 text-sm text-error break-words">
          无法读取 {failed.provider} 的会话：{failed.message}
        </p>
      ))}
      {projects.isLoading ? (
        <p className="py-8 text-center text-sm text-on-surface-variant/60">加载中…</p>
      ) : null}
      {projects.data && list.length === 0 ? (
        <p className="py-12 text-center text-sm text-on-surface-variant/60">
          还没有项目。在上面添加一个目录，或在 Claude Code、Codex 里开始一段会话。
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((project) => (
          <li
            key={project.id}
            className="group relative flex flex-col gap-2 rounded-xl bg-surface-container-low p-4 transition-colors hover:bg-surface-container"
          >
            <Link
              to={projectUrl(project.id)}
              className="flex items-center gap-2 min-w-0 after:absolute after:inset-0 after:content-['']"
            >
              <FolderOpen className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate text-sm font-semibold text-on-surface">{project.name}</span>
            </Link>
            <p
              className="truncate text-[11px] font-mono text-on-surface-variant/70"
              title={project.path}
            >
              {project.path}
            </p>
            <div className="flex items-center justify-between gap-2">
              <ProviderCounts counts={project.sessionCounts} />
              {project.lastActivity ? (
                <span className="text-[11px] text-on-surface-variant/60">
                  {relativeTime(project.lastActivity)}
                </span>
              ) : null}
            </div>
            <div className="relative z-10 flex items-center gap-1 pt-1">
              <Link
                to={newSessionUrl({ project: project.id })}
                className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-on-surface hover:text-primary"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                新会话
              </Link>
              <button
                type="button"
                disabled={hide.isPending}
                onClick={() => {
                  if (window.confirm(`从列表中隐藏「${project.name}」？目录和会话文件不会改动。`))
                    hide.mutate(project.id);
                }}
                className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-on-surface-variant/60 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-container-high hover:text-on-surface"
                title="隐藏项目"
                aria-label={`隐藏 ${project.name}`}
              >
                <EyeOff className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Link
        to={projectUrl(UNASSIGNED)}
        className="mt-6 inline-flex items-center gap-2 text-sm text-on-surface-variant hover:text-primary"
      >
        <Inbox className="w-4 h-4" aria-hidden="true" />
        未归属会话：没有在任何项目目录里运行的会话
      </Link>
    </div>
  );
}
