import type {
  ImportJob,
  LibraryPaper,
  LibraryPaperDetail,
  LibrarySearchResult,
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
  jobs: (signal?: AbortSignal) =>
    requestJson<{ jobs: ImportJob[] }>("/api/library/imports", { signal }),
  upload: (files: File[]) => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return requestJson<ImportJob>("/api/library/imports", { method: "POST", body });
  },
  retry: (id: string) =>
    requestJson<ImportJob>(`/api/library/imports/${pathSegment(id)}/retry`, { method: "POST" }),
  position: (id: string, signal?: AbortSignal) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, { signal }),
  savePosition: (id: string, position: ReadingPosition) =>
    requestJson<ReadingPosition>(`/api/library/papers/${pathSegment(id)}/position`, {
      method: "PUT",
      body: JSON.stringify(position),
    }),
};
const uploadedFiles = new WeakMap<File, Map<string, Promise<SessionAttachment>>>();

export const sessionApi = {
  async upload(id: string, files: File[]): Promise<SessionAttachment[]> {
    return Promise.all(
      files.map((file) => {
        let sessions = uploadedFiles.get(file);
        if (!sessions) {
          sessions = new Map();
          uploadedFiles.set(file, sessions);
        }
        let pending = sessions.get(id);
        if (!pending) {
          const body = new FormData();
          body.set("file", file);
          pending = fetch(`/api/sessions/${pathSegment(id)}/attachments`, {
            method: "POST",
            headers: { "ScholarAIO-Hub": "true" },
            body,
          })
            .then(async (response) => {
              if (!response.ok)
                throw new Error(`附件上传失败 (${response.status})：${await response.text()}`);
              return response.json() as Promise<SessionAttachment>;
            })
            .catch((error) => {
              sessions.delete(id);
              throw error;
            });
          sessions.set(id, pending);
        }
        return pending;
      }),
    );
  },
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
  ) =>
    requestJson<StoredSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ provider, paperIds, model, projectId, ...execution }),
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
