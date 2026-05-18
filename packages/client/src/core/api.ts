import type {
  AppSessionSummary,
  FileContentResponse,
  NewSessionDefaults,
  PermissionMode,
  ProviderInfo,
  ProviderName,
  ThinkingOption,
  UploadedFile,
} from "@scholaraio-hub/shared";
import type {
  CreateSessionInput,
  ProcessSummary,
  ProjectSummary,
  QueueMessageInput,
  ResumeSessionInput,
  ServerSettings,
  SessionCreationResult,
  SessionDetail,
  StartSessionInput,
} from "./types";
import { uploadFile } from "./upload";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : response.statusText;
    throw new Error(message || "Request failed");
  }

  return payload as T;
}

export const api = {
  getProjects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),
  addProject: (path: string) =>
    request<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  getProject: (projectId: string) =>
    request<{ project: ProjectSummary }>(`/api/projects/${projectId}`),
  getProjectSessions: (projectId: string) =>
    request<{ sessions: AppSessionSummary[] }>(`/api/projects/${projectId}/sessions`),
  getSession: (
    projectId: string,
    sessionId: string,
    options?: { beforeMessageId?: string; tailCompactions?: number },
  ) => {
    const params = new URLSearchParams();
    if (options?.beforeMessageId) params.set("beforeMessageId", options.beforeMessageId);
    if (options?.tailCompactions) params.set("tailCompactions", String(options.tailCompactions));
    const qs = params.toString();
    return request<SessionDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}${qs ? `?${qs}` : ""}`,
    );
  },
  getProcesses: () =>
    request<{ processes: ProcessSummary[]; terminatedProcesses?: ProcessSummary[] }>(
      "/api/processes?includeTerminated=true",
    ),
  getProviders: () => request<{ providers: ProviderInfo[] }>("/api/providers"),
  getSettings: () => request<{ settings: ServerSettings }>("/api/settings"),
  updateSettings: (settings: Partial<ServerSettings>) =>
    request<{ settings: ServerSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getVersion: () =>
    request<{
      current: string;
      latest: string | null;
      updateAvailable: boolean;
      resumeProtocolVersion?: number;
      capabilities?: string[];
    }>("/api/version"),
  getFile: (projectId: string, filePath: string, highlight = true) =>
    request<FileContentResponse>(
      `/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}&highlight=${highlight ? "true" : "false"}`,
    ),
  getFileRawUrl: (projectId: string, filePath: string, download = false) =>
    `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(filePath)}${download ? "&download=true" : ""}`,
  startSession: (input: StartSessionInput) =>
    request<SessionCreationResult>(`/api/projects/${input.projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        mode: input.mode,
        model: input.model,
        thinking: input.thinking,
        provider: input.provider,
        attachments: input.attachments,
      }),
    }),
  createSession: (input: CreateSessionInput) =>
    request<SessionCreationResult>(`/api/projects/${input.projectId}/sessions/create`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resumeSession: (input: ResumeSessionInput) =>
    request<SessionCreationResult>(
      `/api/projects/${input.projectId}/sessions/${input.sessionId}/resume`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.message,
          mode: input.mode,
          model: input.model,
          thinking: input.thinking,
          provider: input.provider,
          attachments: input.attachments,
        }),
      },
    ),
  queueMessage: (input: QueueMessageInput) =>
    request<{ queued: boolean; restarted?: boolean; processId?: string }>(
      `/api/sessions/${input.sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.message,
          mode: input.mode,
          thinking: input.thinking,
          attachments: input.attachments,
        }),
      },
    ),
  respondToInput: (
    sessionId: string,
    requestId: string,
    response: "approve" | "approve_accept_edits" | "deny",
    feedback?: string,
  ) =>
    request<{ accepted: boolean }>(`/api/sessions/${sessionId}/input`, {
      method: "POST",
      body: JSON.stringify({ requestId, response, feedback }),
    }),
  setPermissionMode: (sessionId: string, mode: PermissionMode) =>
    request<{ permissionMode: PermissionMode; modeVersion: number }>(
      `/api/sessions/${sessionId}/mode`,
      {
        method: "PUT",
        body: JSON.stringify({ mode }),
      },
    ),
  setHold: (sessionId: string, hold: boolean) =>
    request<{ isHeld: boolean; holdSince: string | null; state: string }>(
      `/api/sessions/${sessionId}/hold`,
      {
        method: "PUT",
        body: JSON.stringify({ hold }),
      },
    ),
  interruptProcess: (processId: string) =>
    request<{ interrupted: boolean; supported: boolean }>(`/api/processes/${processId}/interrupt`, {
      method: "POST",
    }),
  abortProcess: (processId: string) =>
    request<{ aborted: boolean }>(`/api/processes/${processId}/abort`, {
      method: "POST",
    }),
  changeModel: (processId: string, model?: string) =>
    request<{ success: boolean; model?: string }>(`/api/processes/${processId}/model`, {
      method: "POST",
      body: JSON.stringify({ model }),
    }),
  updateSessionMetadata: (
    sessionId: string,
    updates: { title?: string; starred?: boolean; archived?: boolean },
  ) =>
    request(`/api/sessions/${sessionId}/metadata`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  uploadAttachment: (
    projectId: string,
    sessionId: string,
    file: File,
    onProgress?: (uploaded: number, total: number) => void,
  ) => uploadFile(projectId, sessionId, file, { onProgress }),
};

export const scholar = {
  getPapers: (params?: { sort?: string; year?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.year) qs.set("year", params.year);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    return request<{ papers: ScholarPaper[]; total: number }>(
      `/api/scholar/api/papers${qs.toString() ? `?${qs}` : ""}`,
    );
  },
  getPaper: (id: string) =>
    request<{ paper: ScholarPaper & { content?: string; l3Conclusion?: string } }>(
      `/api/scholar/api/papers/${id}`,
    ),
  getStats: () =>
    request<{ total: number; missingPdf: number; pendingIngest: number; notIndexed: number }>(
      "/api/scholar/api/stats",
    ),
  search: (body: {
    query: string;
    mode?: string;
    year?: string;
    journal?: string;
    paper_type?: string;
    limit?: number;
  }) =>
    request<{ results: ScholarPaper[]; mode: string; total: number }>("/api/scholar/api/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspaces: () =>
    request<{ workspaces: ScholarWorkspaceSummary[] }>("/api/scholar/api/workspaces"),
  getWorkspace: (name: string) =>
    request<{ workspace: ScholarWorkspace }>(`/api/scholar/api/workspaces/${name}`),
  createWorkspace: (name: string) =>
    request<{ workspace: ScholarWorkspace }>("/api/scholar/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  addPaperToWorkspace: (workspaceName: string, paperId: string) =>
    request<{ ok: boolean }>(
      `/api/scholar/api/workspaces/${encodeURIComponent(workspaceName)}/papers`,
      {
        method: "POST",
        body: JSON.stringify({ paperId }),
      },
    ),
  getConfig: () =>
    request<{
      llm: { backend: string; model: string; base_url: string; api_key: string };
      embed: { model: string; source: string; api_key: string };
      ingest: { mineru_endpoint: string; mineru_api_key: string; s2_api_key: string };
      paths: { papers_dir: string; workspace_dir: string };
    }>("/api/scholar/api/config"),
};

export interface ScholarPaper {
  id: string;
  dirName: string;
  title: string;
  authors: string;
  source: string;
  year: number;
  date?: string;
  citations: string;
  status: "ingested" | "indexing" | "pending" | "no-pdf";
  /** `paper.md` が存在するか（処理済みか）を示す。L4 全文の可否に対応。 */
  hasPdf?: boolean;
  /** `paper.pdf` が存在するか。PDF ビューアーの表示可否に対応。 */
  hasPdfFile?: boolean;
  isIndexed?: boolean;
  abstract?: string;
  doi?: string;
  match?: string;
  score?: number;
}

export interface ScholarWorkspaceSummary {
  id: string;
  name: string;
  paperCount: number;
  createdAt: string;
}

export interface ScholarWorkspace extends ScholarWorkspaceSummary {
  papers: ScholarPaper[];
}

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

export const THINKING_OPTIONS: readonly ThinkingOption[] = ["off", "auto", "on:medium", "on:high"];

export const DEFAULT_NEW_SESSION: NewSessionDefaults = {
  provider: "claude",
  permissionMode: "default",
};

export function getProviderChoices(providers: ProviderInfo[]): ProviderInfo[] {
  return providers.filter((provider) => provider.name === "claude" || provider.name === "codex");
}

export function providerLabel(provider: ProviderName | string | undefined): string {
  if (provider === "claude-ollama") return "Claude Ollama";
  if (provider === "codex-oss") return "Codex OSS";
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return provider ?? "Unknown";
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "object" && item !== null) {
        const maybeText = item as { text?: string; content?: string; type?: string };
        return maybeText.text ?? maybeText.content ?? (maybeText.type ? `[${maybeText.type}]` : "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}
