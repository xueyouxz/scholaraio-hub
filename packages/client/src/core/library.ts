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

/** 提供文献、文献集合、导入、设置和维护任务的业务请求。 */
export const libraryApi = {
  revealDirectory: (target: "data" | "papers" | "workspaces") =>
    request("post", "/directories/{target}/reveal", { path: { target } }),
  images: (id: string, signal?: AbortSignal) =>
    request("get", "/papers/{paper_id}/images", { path: { paper_id: id }, signal }),
  analytics: (signal?: AbortSignal) => request("get", "/analytics", { signal }),
  collections: (signal?: AbortSignal) => request("get", "/collections", { signal }),
  collection: (id: string, signal?: AbortSignal) =>
    request("get", "/collections/{collection_id}", { path: { collection_id: id }, signal }),
  createCollection: (name: string) => request("post", "/collections", { body: { name } }),
  renameCollection: (id: string, name: string) =>
    request("post", "/collections/{collection_id}/rename", {
      path: { collection_id: id },
      body: { name },
    }),
  archiveCollection: (id: string) =>
    request("delete", "/collections/{collection_id}", { path: { collection_id: id } }),
  collectionPapers: (id: string, paperIds: string[], action: "add" | "remove") =>
    request("post", "/collections/{collection_id}/papers", {
      path: { collection_id: id },
      body: { paperIds, action },
    }),
  search: (
    params: { query: string; mode: string; limit: number; collectionId?: string },
    signal?: AbortSignal,
  ) =>
    request("get", "/search", {
      query: {
        q: params.query,
        mode: params.mode,
        limit: params.limit,
        collectionId: params.collectionId,
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
  references: (id: string, signal?: AbortSignal, collectionId?: string) =>
    request("get", "/papers/{paper_id}/references", {
      path: { paper_id: id },
      query: { collectionId },
      signal,
    }),
  citing: (id: string, signal?: AbortSignal, collectionId?: string) =>
    request("get", "/papers/{paper_id}/citing", {
      path: { paper_id: id },
      query: { collectionId },
      signal,
    }),
  jobs: (signal?: AbortSignal) => request("get", "/imports", { signal }),
  /** 上传文献文件并创建导入任务。 */
  upload: (files: File[], collectionId?: string, signal?: AbortSignal) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (collectionId) form.append("collectionId", collectionId);
    return request("post", "/imports", { form, signal, timeoutMs: UPLOAD_TIMEOUT_MS });
  },
  discover: (query: string, signal?: AbortSignal) =>
    request("get", "/discover", { query: { q: query }, signal }),
  exportReferences: (body: Omit<ExportInput, "style"> & { style?: ExportInput["style"] }) =>
    request("post", "/citations/export", { body: { ...body, style: body.style ?? "apa" } }),
  fetchPaper: (locator: string, collectionId?: string, title?: string) =>
    request("post", "/imports/fetch", { body: { locator, collectionId, title } }),
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

/** 构造文献集合页面地址。 */
export function collectionUrl(collectionId: string): string {
  return `/library/collections/${encodeURIComponent(collectionId)}`;
}

/** 构造包含返回页面和文献集合范围的文献阅读地址。 */
export function readerUrl(
  paperId: string,
  options: { returnTo?: string; collectionId?: string } = {},
): string {
  const params = new URLSearchParams({ mode: "overview" });
  if (options.returnTo) params.set("returnTo", options.returnTo);
  if (options.collectionId) params.set("collection", options.collectionId);
  return `/library/${encodeURIComponent(paperId)}?${params}`;
}
