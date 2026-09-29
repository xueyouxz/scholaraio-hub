import type {
  ProjectList,
  ProjectSummary,
  ProviderName,
  SessionPage,
} from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { hubHttp, pathSegment } from "./http";

/** Sessions that ran in no project's directory, where a project id would go. */
export const UNASSIGNED = "unassigned";

/** How long the system's folder dialog may stay open; the server closes it with the request. */
const FOLDER_DIALOG_TIMEOUT_MS = 10 * 60_000;

/** 项目：各 Provider 自己保存的会话按工作目录分组。 */
export const projectApi = {
  list: (signal?: AbortSignal) => hubHttp.json<ProjectList>("/projects", { signal }),
  /** 一个项目的会话（`UNASSIGNED` 为不属于任何项目的会话），按最近更新排序分页。 */
  sessions: (
    project: string,
    page: { offset?: number; limit: number; provider?: ProviderName },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ limit: String(page.limit) });
    if (page.offset) params.set("offset", String(page.offset));
    if (page.provider) params.set("provider", page.provider);
    return hubHttp.json<SessionPage>(`/projects/${pathSegment(project)}/sessions?${params}`, {
      signal,
    });
  },
  /** 在本机系统的对话框里选择文件夹；取消时 `path` 为 null。 */
  pickFolder: () =>
    hubHttp.json<{ path: string | null }>("/projects/pick-folder", {
      method: "POST",
      timeoutMs: FOLDER_DIALOG_TIMEOUT_MS,
    }),
  /** 在还没有会话的目录上添加项目。 */
  add: (path: string) =>
    hubHttp.json<ProjectSummary>("/projects", { method: "POST", json: { path } }),
  /** 从列表中隐藏项目；磁盘上的文件不变。 */
  hide: (id: string) => hubHttp.json<void>(`/projects/${pathSegment(id)}`, { method: "DELETE" }),
};

/**
 * Add a project the way Claude Code does: the person chooses its folder in the
 * system's dialog. Null when they cancel.
 */
export async function addChosenFolder(): Promise<ProjectSummary | null> {
  const { path } = await projectApi.pickFolder();
  return path ? projectApi.add(path) : null;
}

/** Every list of projects and sessions starts with this key, so one invalidation refreshes them all. */
export const PROJECTS_KEY = ["projects"] as const;

export const projectsQuery = queryOptions({
  queryKey: PROJECTS_KEY,
  queryFn: ({ signal }) => projectApi.list(signal),
});

/** The first `limit` sessions of a project (or of `UNASSIGNED`), optionally one provider's. */
export const projectSessionsQuery = (project: string, limit: number, provider?: ProviderName) =>
  queryOptions({
    queryKey: [...PROJECTS_KEY, project, "sessions", { limit, provider }],
    queryFn: ({ signal }) => projectApi.sessions(project, { limit, provider }, signal),
  });

/** The address of a project's page. */
export function projectUrl(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}
