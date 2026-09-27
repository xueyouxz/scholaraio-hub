import type {
  LibraryPaths,
  LibraryTaskKind,
  ReadingPosition,
  SettingsCheck,
} from "@scholaraio-hub/shared";
import { UPLOAD_TIMEOUT_MS } from "./http";
import { libraryClient } from "./libraryClient";

/** 文献元数据更新请求。 */
type MetadataInput =
  LibraryPaths["/papers/{paper_id}"]["patch"]["requestBody"]["content"]["application/json"];
/** 文献服务配置更新请求。 */
type SettingsInput =
  LibraryPaths["/settings"]["patch"]["requestBody"]["content"]["application/json"];
type ExportInput =
  LibraryPaths["/citations/export"]["post"]["requestBody"]["content"]["application/json"];
export type ReferenceFormat = NonNullable<ExportInput["format"]>;

const { request } = libraryClient;

/** 提供文献、项目、导入、设置和维护任务的业务请求。 */
export const libraryApi = {
  revealDirectory: (target: "data" | "papers" | "workspaces") =>
    request("post", "/directories/{target}/reveal", { path: { target } }),
  images: (id: string, signal?: AbortSignal) =>
    request("get", "/papers/{paper_id}/images", { path: { paper_id: id }, signal }),
  analytics: (signal?: AbortSignal) => request("get", "/analytics", { signal }),
  projects: (signal?: AbortSignal) => request("get", "/projects", { signal }),
  project: (id: string, signal?: AbortSignal) =>
    request("get", "/projects/{project_id}", { path: { project_id: id }, signal }),
  createProject: (name: string) => request("post", "/projects", { body: { name } }),
  renameProject: (id: string, name: string) =>
    request("post", "/projects/{project_id}/rename", { path: { project_id: id }, body: { name } }),
  archiveProject: (id: string) =>
    request("delete", "/projects/{project_id}", { path: { project_id: id } }),
  projectPapers: (id: string, paperIds: string[], action: "add" | "remove") =>
    request("post", "/projects/{project_id}/papers", {
      path: { project_id: id },
      body: { paperIds, action },
    }),
  search: (
    params: { query: string; mode: string; limit: number; projectId?: string },
    signal?: AbortSignal,
  ) =>
    request("get", "/search", {
      query: {
        q: params.query,
        mode: params.mode,
        limit: params.limit,
        projectId: params.projectId,
      },
      signal,
    }),
  papers: (signal?: AbortSignal) => request("get", "/papers", { signal }),
  detail: (id: string, signal?: AbortSignal) =>
    request("get", "/papers/{paper_id}", { path: { paper_id: id }, signal }),
  updatePaper: (id: string, fields: MetadataInput) =>
    request("patch", "/papers/{paper_id}", { path: { paper_id: id }, body: fields }),
  refetchPaper: (id: string) =>
    request("post", "/papers/{paper_id}/refetch", { path: { paper_id: id } }),
  references: (id: string, signal?: AbortSignal, projectId?: string) =>
    request("get", "/papers/{paper_id}/references", {
      path: { paper_id: id },
      query: { projectId },
      signal,
    }),
  citing: (id: string, signal?: AbortSignal, projectId?: string) =>
    request("get", "/papers/{paper_id}/citing", {
      path: { paper_id: id },
      query: { projectId },
      signal,
    }),
  jobs: (signal?: AbortSignal) => request("get", "/imports", { signal }),
  /** 上传文献文件并创建导入任务。 */
  upload: (files: File[], projectId?: string, signal?: AbortSignal) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (projectId) form.append("projectId", projectId);
    return request("post", "/imports", { form, signal, timeoutMs: UPLOAD_TIMEOUT_MS });
  },
  discover: (query: string, signal?: AbortSignal) =>
    request("get", "/discover", { query: { q: query }, signal }),
  exportReferences: (body: Omit<ExportInput, "style"> & { style?: ExportInput["style"] }) =>
    request("post", "/citations/export", { body: { ...body, style: body.style ?? "apa" } }),
  fetchPaper: (locator: string, projectId?: string, title?: string) =>
    request("post", "/imports/fetch", { body: { locator, projectId, title } }),
  retry: (id: string) => request("post", "/imports/{job_id}/retry", { path: { job_id: id } }),
  settings: (signal?: AbortSignal) => request("get", "/settings", { signal }),
  saveSettings: (fields: SettingsInput) => request("patch", "/settings", { body: fields }),
  checkSettings: (target: SettingsCheck["target"]) =>
    request("post", "/settings/check", { body: { target } }),
  capabilities: (signal?: AbortSignal) => request("get", "/tasks", { signal }),
  vectorRuntime: (signal?: AbortSignal) => request("get", "/runtime", { signal }),
  installVectorRuntime: () =>
    request("post", "/runtime/{capability}", { path: { capability: "semantic" } }),
  startTask: (kind: LibraryTaskKind) => request("post", "/tasks/{kind}", { path: { kind } }),
  cancelTask: (kind: LibraryTaskKind) => request("delete", "/tasks/{kind}", { path: { kind } }),
  position: (id: string, signal?: AbortSignal) =>
    request("get", "/papers/{paper_id}/position", { path: { paper_id: id }, signal }),
  savePosition: (id: string, position: ReadingPosition) =>
    request("put", "/papers/{paper_id}/position", { path: { paper_id: id }, body: position }),
};

/** 构造项目工作区页面地址。 */
export function workspaceUrl(projectId: string): string {
  return `/workspaces/${encodeURIComponent(projectId)}`;
}

/** 构造包含返回页面和项目范围的文献阅读地址。 */
export function readerUrl(
  paperId: string,
  options: { returnTo?: string; projectId?: string } = {},
): string {
  const params = new URLSearchParams({ mode: "overview" });
  if (options.returnTo) params.set("returnTo", options.returnTo);
  if (options.projectId) params.set("project", options.projectId);
  return `/library/${encodeURIComponent(paperId)}?${params}`;
}
