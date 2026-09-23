import type {
  ImportJob,
  LibraryCapabilities,
  LibraryPaper,
  LibraryPaperDetail,
  LibraryReference,
  LibrarySearchResult,
  LibrarySettings,
  LibraryTask,
  LibraryTaskKind,
  LiteratureProject,
  NewSessionDefaults,
  ProjectFsBrowseResponse,
  ProviderInfo,
  ProviderUsageLimits,
  ReadingPosition,
  ScholaraioSkillDetail,
  ScholaraioSkillsResponse,
  SessionAttachment,
  SessionFileContent,
  SessionInput,
  SlashCommand,
  StoredSession,
} from "@scholaraio-hub/shared";
import { pathSegment, requestJson } from "./http";

/** Execution options a session can change, in the provider's own terms. */
export type SessionOptions = Partial<
  Pick<StoredSession, "model" | "permissionMode" | "thinking" | "effort">
>;
import type {
  ScholarProjection,
  ScholarTopicSimilarity,
  ScholarTopicsOverview,
} from "./scholarTypes";

export const libraryApi = {
  images: (id: string, signal?: AbortSignal) =>
    requestJson<{ images: string[] }>(`/api/library/papers/${pathSegment(id)}/images`, { signal }),
  analytics: (projectId?: string, signal?: AbortSignal) =>
    requestJson<{
      topics: ScholarTopicsOverview;
      projection: ScholarProjection;
      similarity: ScholarTopicSimilarity;
    }>(`/api/library/analytics${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, {
      signal,
    }),
  projects: (signal?: AbortSignal) =>
    requestJson<{ projects: LiteratureProject[] }>("/api/library/projects", { signal }),
  project: (id: string, signal?: AbortSignal) =>
    requestJson<LiteratureProject>(`/api/library/projects/${pathSegment(id)}`, { signal }),
  createProject: (name: string) =>
    requestJson<LiteratureProject>("/api/library/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameProject: (id: string, name: string) =>
    requestJson<{ project: LiteratureProject; sessions: number }>(
      `/api/library/projects/${pathSegment(id)}/rename`,
      { method: "POST", body: JSON.stringify({ name }) },
    ),
  archiveProject: (id: string) =>
    requestJson<{ archived: { id: string; archivedAt: string }; sessions: number }>(
      `/api/library/projects/${pathSegment(id)}`,
      { method: "DELETE" },
    ),
  projectPapers: (id: string, paperIds: string[], action: "add" | "remove") =>
    requestJson<LiteratureProject>(`/api/library/projects/${pathSegment(id)}/papers`, {
      method: "POST",
      body: JSON.stringify({ paperIds, action }),
    }),
  papers: (signal?: AbortSignal) =>
    requestJson<{ papers: LibraryPaper[] }>("/api/library/papers", { signal }),
  search: (query: string, signal?: AbortSignal, projectId?: string) =>
    requestJson<{ results: LibrarySearchResult[] }>(
      `/api/library/search?q=${encodeURIComponent(query)}&limit=200${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`,
      { signal },
    ),
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
  upload: (files: File[]) => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return requestJson<ImportJob>("/api/library/imports", { method: "POST", body });
  },
  retry: (id: string) =>
    requestJson<ImportJob>(`/api/library/imports/${pathSegment(id)}/retry`, { method: "POST" }),
  settings: (signal?: AbortSignal) =>
    requestJson<LibrarySettings>("/api/library/settings", { signal }),
  saveSettings: (fields: Partial<Record<string, string>>) =>
    requestJson<LibrarySettings>("/api/library/settings", {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  capabilities: (signal?: AbortSignal) =>
    requestJson<LibraryCapabilities>("/api/library/tasks", { signal }),
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
/** Where a composer's files go: an existing session, or the draft area of a new chat. */
export type AttachmentTarget = { sessionId: string } | "draft";

const attachmentsPath = (target: AttachmentTarget) =>
  target === "draft"
    ? "/api/sessions/draft-attachments"
    : `/api/sessions/${pathSegment(target.sessionId)}/attachments`;

export const sessionApi = {
  /**
   * Upload one file, reporting progress (0–1). XHR rather than fetch because
   * fetch cannot report upload progress.
   */
  uploadAttachment(
    target: AttachmentTarget,
    file: File,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<SessionAttachment> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", attachmentsPath(target));
      request.setRequestHeader("ScholarAIO-Hub", "true");
      request.responseType = "json";
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve(request.response as SessionAttachment);
          return;
        }
        const payload = request.response as { error?: string } | null;
        reject(new Error(payload?.error ?? `附件上传失败 (${request.status})`));
      };
      request.onerror = () => reject(new Error("附件上传失败：网络错误"));
      request.onabort = () => reject(new DOMException("上传已取消", "AbortError"));
      signal?.addEventListener("abort", () => request.abort(), { once: true });
      const body = new FormData();
      body.set("file", file);
      request.send(body);
    });
  },
  /** Take back an uploaded file that has not been sent. */
  removeAttachment: (target: AttachmentTarget, attachmentId: string) =>
    requestJson<void>(`${attachmentsPath(target)}/${pathSegment(attachmentId)}`, {
      method: "DELETE",
    }),
  async begin(
    id: string,
    messageId: string,
    text: string,
    attachmentIds: string[] = [],
  ): Promise<void> {
    try {
      const response = await fetch(`/api/sessions/${pathSegment(id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ScholarAIO-Hub": "true" },
        body: JSON.stringify({ id: messageId, text, attachmentIds }),
      });
      if (!response.ok)
        throw new Error(`首条消息提交失败 (${response.status})：${await response.text()}`);
      // The server owns the run. The conversation page resumes the same stream.
      await response.body?.cancel();
    } catch (error) {
      // A lost response can still have accepted the input. Check its stable ID
      // before allowing a retry, so the first turn is never duplicated.
      const current = await sessionApi.get(id);
      if (!current.messages.some((message) => message.id === messageId)) throw error;
    }
  },
  commands: (provider: "claude" | "codex", sessionId?: string, signal?: AbortSignal) =>
    requestJson<{ commands: SlashCommand[] }>(
      sessionId
        ? `/api/sessions/${pathSegment(sessionId)}/commands`
        : `/api/sessions/commands?provider=${provider}`,
      { signal },
    ),
  browseFiles: (id: string, relative = "", signal?: AbortSignal) =>
    requestJson<ProjectFsBrowseResponse>(
      `/api/sessions/${pathSegment(id)}/fs/browse?path=${encodeURIComponent(relative)}`,
      { signal },
    ),
  file: (id: string, relative: string, signal?: AbortSignal) =>
    requestJson<SessionFileContent>(
      `/api/sessions/${pathSegment(id)}/fs/file?path=${encodeURIComponent(relative)}`,
      { signal },
    ),
  list: (signal?: AbortSignal) =>
    requestJson<{ sessions: StoredSession[] }>("/api/sessions", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}`, { signal }),
  create: (
    provider: "claude" | "codex",
    paperIds: string[] = [],
    model?: string,
    projectId?: string,
    execution?: Omit<SessionOptions, "model">,
    /** Draft uploads the new session takes over. */
    attachmentIds: string[] = [],
  ) =>
    requestJson<StoredSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider, paperIds, model, projectId, ...execution, attachmentIds }),
    }),
  options: (id: string, options: SessionOptions) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}/options`, {
      method: "PATCH",
      body: JSON.stringify(options),
    }),
  enqueue: (id: string, input: SessionInput) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}/queue`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  editQueue: (id: string, action: "resume" | "remove", messageId?: string) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}/queue`, {
      method: "PATCH",
      body: JSON.stringify({ action, messageId }),
    }),
  stop: (id: string) => requestJson(`/api/sessions/${pathSegment(id)}/stop`, { method: "POST" }),
  input: (
    id: string,
    requestId: string,
    decision: "approve" | "approve_accept_edits" | "deny",
    answers?: Record<string, string>,
  ) =>
    requestJson(`/api/sessions/${pathSegment(id)}/input`, {
      method: "POST",
      body: JSON.stringify({ requestId, decision, answers }),
    }),
};

export const settingsApi = {
  get: (signal?: AbortSignal) =>
    requestJson<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/api/settings", {
      signal,
    }),
  save: (newSessionDefaults: NewSessionDefaults) =>
    requestJson<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ newSessionDefaults }),
    }),
  providers: (signal?: AbortSignal) =>
    requestJson<{ providers: ProviderInfo[] }>("/api/providers", { signal }),
  usageLimits: (signal?: AbortSignal) =>
    requestJson<{ usageLimits: ProviderUsageLimits[] }>("/api/providers/usage-limits", {
      signal,
    }),
};

/** Research skills browsed from SCHOLARAIO_SKILLS_DIR. */
export const skillsApi = {
  list: (signal?: AbortSignal) =>
    requestJson<ScholaraioSkillsResponse>("/api/skills/scholaraio", { signal }),
  get: (name: string, signal?: AbortSignal) =>
    requestJson<ScholaraioSkillDetail>(`/api/skills/scholaraio/${pathSegment(name)}`, { signal }),
  refresh: () =>
    requestJson<{ refreshed: boolean; count: number }>("/api/skills/scholaraio/refresh", {
      method: "POST",
    }),
};

export function providerLabel(provider: string | undefined): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return provider ?? "Unknown";
}

export function newSessionUrl(projectId?: string, paperIds: string[] = []) {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (paperIds.length) params.set("papers", paperIds.join(","));
  return `/sessions${params.size ? `?${params}` : ""}`;
}
