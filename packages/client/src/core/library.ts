import type {
  ArchivedProject,
  DiscoverResponse,
  ExportFile,
  FetchedImportJob,
  ImportJob,
  LibraryAnalytics,
  LibraryCapabilities,
  LibraryPaper,
  LibraryPaperDetail,
  LibraryReference,
  LibrarySearchResponse,
  LibrarySettings,
  LibraryTask,
  LibraryTaskKind,
  LiteratureProject,
  ReadingPosition,
  SettingsCheck,
  VectorRuntimeStatus,
} from "@scholaraio-hub/shared";
import { pathSegment, requestJson } from "./http";

/** The reference-file formats the library exports. */
export type ReferenceFormat = "bibtex" | "ris" | "markdown";

export const libraryApi = {
  images: (id: string, signal?: AbortSignal) =>
    requestJson<{ images: string[] }>(`/api/library/papers/${pathSegment(id)}/images`, { signal }),
  analytics: (signal?: AbortSignal) =>
    requestJson<LibraryAnalytics>("/api/library/analytics", { signal }),
  projects: (signal?: AbortSignal) =>
    requestJson<{ projects: LiteratureProject[] }>("/api/library/projects", { signal }),
  project: (id: string, signal?: AbortSignal) =>
    requestJson<LiteratureProject>(`/api/library/projects/${pathSegment(id)}`, { signal }),
  createProject: (name: string) =>
    requestJson<LiteratureProject>("/api/library/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  /** The project keeps its id, so the sessions that refer to it follow. */
  renameProject: (id: string, name: string) =>
    requestJson<LiteratureProject>(`/api/library/projects/${pathSegment(id)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  archiveProject: (id: string) =>
    requestJson<ArchivedProject>(`/api/library/projects/${pathSegment(id)}`, {
      method: "DELETE",
    }),
  projectPapers: (id: string, paperIds: string[], action: "add" | "remove") =>
    requestJson<LiteratureProject>(`/api/library/projects/${pathSegment(id)}/papers`, {
      method: "POST",
      body: JSON.stringify({ paperIds, action }),
    }),
  /** Papers matching `query`, best first; within a workspace when `projectId` is given. */
  search: (
    params: { query: string; mode: string; limit: number; projectId?: string },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      q: params.query,
      mode: params.mode,
      limit: String(params.limit),
    });
    if (params.projectId) query.set("projectId", params.projectId);
    return requestJson<LibrarySearchResponse>(`/api/library/search?${query}`, { signal });
  },
  papers: (signal?: AbortSignal) =>
    requestJson<{ papers: LibraryPaper[] }>("/api/library/papers", { signal }),
  detail: (id: string, signal?: AbortSignal) =>
    requestJson<LibraryPaperDetail>(`/api/library/papers/${pathSegment(id)}`, { signal }),
  updatePaper: (id: string, fields: Record<string, unknown>) =>
    requestJson<LibraryPaper>(`/api/library/papers/${pathSegment(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  refetchPaper: (id: string) =>
    requestJson<{ changed: boolean; paper: LibraryPaper }>(
      `/api/library/papers/${pathSegment(id)}/refetch`,
      { method: "POST" },
    ),
  references: (id: string, signal?: AbortSignal, projectId?: string) =>
    requestJson<{ references: LibraryReference[] }>(
      `/api/library/papers/${pathSegment(id)}/references${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { signal },
    ),
  citing: (id: string, signal?: AbortSignal, projectId?: string) =>
    requestJson<{ citing: LibraryPaper[] }>(
      `/api/library/papers/${pathSegment(id)}/citing${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { signal },
    ),
  jobs: (signal?: AbortSignal) =>
    requestJson<{ jobs: ImportJob[] }>("/api/library/imports", { signal }),
  /** Upload PDFs for import; with a workspace, each paper joins it once it is in. */
  upload: (files: File[], projectId?: string) => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    if (projectId) body.append("projectId", projectId);
    return requestJson<ImportJob>("/api/library/imports", { method: "POST", body });
  },
  /** Papers on the open web the library could fetch. */
  discover: (query: string, signal?: AbortSignal) =>
    requestJson<DiscoverResponse>(`/api/library/discover?q=${encodeURIComponent(query)}`, {
      signal,
    }),
  exportReferences: (body: { paperIds: string[]; format: ReferenceFormat }) =>
    requestJson<ExportFile>("/api/library/citations/export", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  fetchPaper: (locator: string, projectId?: string, title?: string) =>
    requestJson<FetchedImportJob>("/api/library/imports/fetch", {
      method: "POST",
      body: JSON.stringify({ locator, projectId, title }),
    }),
  retry: (id: string) =>
    requestJson<ImportJob>(`/api/library/imports/${pathSegment(id)}/retry`, { method: "POST" }),
  settings: (signal?: AbortSignal) =>
    requestJson<LibrarySettings>("/api/library/settings", { signal }),
  saveSettings: (fields: Partial<Record<string, string>>) =>
    requestJson<LibrarySettings>("/api/library/settings", {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  /** Try one configured service with the saved settings. */
  checkSettings: (target: SettingsCheck["target"]) =>
    requestJson<SettingsCheck>("/api/library/settings/check", {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  capabilities: (signal?: AbortSignal) =>
    requestJson<LibraryCapabilities>("/api/library/tasks", { signal }),
  vectorRuntime: (signal?: AbortSignal) =>
    requestJson<VectorRuntimeStatus>("/api/library/runtime", { signal }),
  installVectorRuntime: () =>
    requestJson<VectorRuntimeStatus>("/api/library/runtime/semantic", { method: "POST" }),
  startTask: (kind: LibraryTaskKind) =>
    requestJson<LibraryTask>(`/api/library/tasks/${pathSegment(kind)}`, { method: "POST" }),
  cancelTask: (kind: LibraryTaskKind) =>
    requestJson<LibraryTask>(`/api/library/tasks/${pathSegment(kind)}`, { method: "DELETE" }),
  position: (id: string, signal?: AbortSignal) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, { signal }),
  savePosition: (id: string, position: ReadingPosition) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, {
      method: "PUT",
      body: JSON.stringify(position),
    }),
};

/** A workspace's own page: its papers, and what is still on its way in. */
export function workspaceUrl(projectId: string): string {
  return `/workspaces/${encodeURIComponent(projectId)}`;
}

/**
 * The reader for a paper. `returnTo` is the page the user opened it from, so
 * "back" goes there; `projectId` scopes it to a workspace.
 */
export function readerUrl(
  paperId: string,
  options: { returnTo?: string; projectId?: string } = {},
): string {
  const params = new URLSearchParams({ mode: "overview" });
  if (options.returnTo) params.set("returnTo", options.returnTo);
  if (options.projectId) params.set("project", options.projectId);
  return `/library/${encodeURIComponent(paperId)}?${params}`;
}
