import type {
  AppSessionSummary,
  FileContentResponse,
  NewSessionDefaults,
  PermissionMode,
  PermissionRules,
  ProjectFsBrowseResponse,
  ProviderInfo,
  ProviderName,
  ProviderUsageLimits,
  ThinkingOption,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { type ApiRequestOptions, pathSegment, requestJson, withQuery } from "./http";
import type {
  CreateSessionInput,
  ProcessSummary,
  ProjectSummary,
  QueueMessageInput,
  ResumeSessionInput,
  ServerSettings,
  SessionCreationResult,
  SessionDetail,
  SessionMetadataDetail,
  StartSessionInput,
} from "./types";
import { type UploadOptions, uploadFile } from "./upload";

const SCHOLAR_API_BASE = "/api/scholar/api/v1";

export type RequestOptions = ApiRequestOptions;

export interface ScholarPaperListParams {
  sort?: string;
  year?: string;
  limit?: number;
  offset?: number;
}

export interface ScholarSearchBody {
  query: string;
  mode?: string;
  year?: string;
  journal?: string;
  paper_type?: string;
  limit?: number;
}

export interface ScholarPaperContentParams {
  layer: 1 | 2 | 3 | 4;
  lang?: string;
}

export interface ScholarPaperContentResponse {
  paperId: string;
  layer: 1 | 2 | 3 | 4;
  content: unknown;
}

export interface ScholarStats {
  total: number;
  missingPdf: number;
  pendingIngest: number;
  notIndexed: number;
}

export interface ScholarConfig {
  llm: { backend: string; model: string; base_url: string; api_key: string };
  embed: {
    provider: string;
    model: string;
    source: string;
    cache_dir: string;
    api_base: string;
    api_key: string;
  };
  ingest: {
    pdf_preferred_parser: string;
    mineru_endpoint: string;
    mineru_api_key: string;
    mineru_cloud_url: string;
    s2_api_key: string;
    mineru_lang: string;
    mineru_parse_method: string;
    abstract_llm_mode: string;
    mineru_enable_formula: boolean;
    mineru_enable_table: boolean;
  };
  paths: { papers_dir: string; workspace_dir: string };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

interface SessionLaunchBodyInput {
  message?: string;
  mode?: PermissionMode;
  model?: string;
  thinking?: ThinkingOption;
  provider?: ProviderName;
  executor?: string;
  remoteEnv?: Record<string, string>;
  permissions?: PermissionRules;
  attachments?: UploadedFile[];
  tempId?: string;
}

function toSessionLaunchBody(input: SessionLaunchBodyInput): SessionLaunchBodyInput {
  return {
    message: input.message,
    mode: input.mode,
    model: input.model,
    thinking: input.thinking,
    provider: input.provider,
    executor: input.executor,
    remoteEnv: input.remoteEnv,
    permissions: input.permissions,
    attachments: input.attachments,
    tempId: input.tempId,
  };
}

export interface HealthLevel {
  level: 1 | 2 | 3;
  label: string;
  status: "ok" | "fail" | "skip";
  detail?: string;
}

export interface HealthCheckResult {
  scope: string;
  levels: HealthLevel[];
}

export const api = {
  getProjects: (options?: RequestOptions) =>
    requestJson<{ projects: ProjectSummary[] }>("/api/projects", { signal: options?.signal }),
  addProject: (path: string) =>
    requestJson<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  getProject: (projectId: string) =>
    requestJson<{ project: ProjectSummary }>(`/api/projects/${projectId}`),
  getProjectSessions: (projectId: string, options?: RequestOptions) =>
    requestJson<{ sessions: AppSessionSummary[] }>(`/api/projects/${projectId}/sessions`, {
      signal: options?.signal,
    }),
  getSession: (
    projectId: string,
    sessionId: string,
    options?: { beforeMessageId?: string; tailCompactions?: number } & RequestOptions,
  ) => {
    const params = new URLSearchParams();
    if (options?.beforeMessageId) params.set("beforeMessageId", options.beforeMessageId);
    if (options?.tailCompactions !== undefined) {
      params.set("tailCompactions", String(options.tailCompactions));
    }
    const qs = params.toString();
    return requestJson<SessionDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}${qs ? `?${qs}` : ""}`,
      { signal: options?.signal },
    );
  },
  getSessionMetadata: (projectId: string, sessionId: string, options?: RequestOptions) =>
    requestJson<SessionMetadataDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}/metadata`,
      { signal: options?.signal },
    ),
  getProcesses: () =>
    requestJson<{ processes: ProcessSummary[]; terminatedProcesses?: ProcessSummary[] }>(
      "/api/processes?includeTerminated=true",
    ),
  getProviders: (options?: RequestOptions) =>
    requestJson<{ providers: ProviderInfo[] }>("/api/providers", { signal: options?.signal }),
  getProviderUsageLimits: (options?: RequestOptions) =>
    requestJson<{ usageLimits: ProviderUsageLimits[] }>("/api/providers/usage-limits", {
      signal: options?.signal,
    }),
  getSettings: (options?: RequestOptions) =>
    requestJson<{ settings: ServerSettings }>("/api/settings", { signal: options?.signal }),
  updateSettings: (settings: Partial<ServerSettings>) =>
    requestJson<{ settings: ServerSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getVersion: (options?: RequestOptions) =>
    requestJson<{
      current: string;
      latest: string | null;
      updateAvailable: boolean;
      resumeProtocolVersion?: number;
      capabilities?: string[];
    }>("/api/version", { signal: options?.signal }),
  browseProjectFs: (projectId: string, path = "", options?: RequestOptions) =>
    requestJson<ProjectFsBrowseResponse>(
      withQuery(`/api/projects/${projectId}/fs/browse`, { path: path || null }),
      { signal: options?.signal },
    ),
  getFile: (projectId: string, filePath: string, highlight = true, options?: RequestOptions) =>
    requestJson<FileContentResponse>(
      withQuery(`/api/projects/${projectId}/files`, { path: filePath, highlight }),
      { signal: options?.signal },
    ),
  getFileRawUrl: (projectId: string, filePath: string, download = false) =>
    withQuery(`/api/projects/${projectId}/files/raw`, {
      path: filePath,
      download: download || null,
    }),
  startSession: (input: StartSessionInput) =>
    requestJson<SessionCreationResult>(`/api/projects/${input.projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify(toSessionLaunchBody(input)),
    }),
  createSession: (input: CreateSessionInput) =>
    requestJson<SessionCreationResult>(`/api/projects/${input.projectId}/sessions/create`, {
      method: "POST",
      body: JSON.stringify(toSessionLaunchBody(input)),
    }),
  resumeSession: (input: ResumeSessionInput) =>
    requestJson<SessionCreationResult>(
      `/api/projects/${input.projectId}/sessions/${input.sessionId}/resume`,
      {
        method: "POST",
        body: JSON.stringify(toSessionLaunchBody(input)),
      },
    ),
  queueMessage: (input: QueueMessageInput) =>
    requestJson<{ queued: boolean; restarted?: boolean; processId?: string; deferred?: boolean }>(
      `/api/sessions/${input.sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.message,
          mode: input.mode,
          thinking: input.thinking,
          attachments: input.attachments,
          tempId: input.tempId,
          deferred: input.deferred,
        }),
      },
    ),
  cancelDeferredMessage: (sessionId: string, tempId: string) =>
    requestJson<{ cancelled: boolean }>(
      `/api/sessions/${sessionId}/deferred/${encodeURIComponent(tempId)}`,
      { method: "DELETE" },
    ),
  respondToInput: (
    sessionId: string,
    requestId: string,
    response: "approve" | "approve_accept_edits" | "deny",
    feedback?: string,
  ) =>
    requestJson<{ accepted: boolean }>(`/api/sessions/${sessionId}/input`, {
      method: "POST",
      body: JSON.stringify({ requestId, response, feedback }),
    }),
  setPermissionMode: (sessionId: string, mode: PermissionMode) =>
    requestJson<{ permissionMode: PermissionMode; modeVersion: number }>(
      `/api/sessions/${sessionId}/mode`,
      {
        method: "PUT",
        body: JSON.stringify({ mode }),
      },
    ),
  setHold: (sessionId: string, hold: boolean) =>
    requestJson<{ isHeld: boolean; holdSince: string | null; state: string }>(
      `/api/sessions/${sessionId}/hold`,
      {
        method: "PUT",
        body: JSON.stringify({ hold }),
      },
    ),
  interruptProcess: (processId: string) =>
    requestJson<{ interrupted: boolean; supported: boolean }>(
      `/api/processes/${processId}/interrupt`,
      {
        method: "POST",
      },
    ),
  abortProcess: (processId: string) =>
    requestJson<{ aborted: boolean }>(`/api/processes/${processId}/abort`, {
      method: "POST",
    }),
  changeModel: (processId: string, model?: string) =>
    requestJson<{ success: boolean; model?: string }>(`/api/processes/${processId}/model`, {
      method: "POST",
      body: JSON.stringify({ model }),
    }),
  updateSessionMetadata: (
    sessionId: string,
    updates: { title?: string; starred?: boolean; archived?: boolean },
  ) =>
    requestJson(`/api/sessions/${sessionId}/metadata`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  uploadAttachment: (
    projectId: string,
    sessionId: string,
    file: File,
    options?: UploadOptions | ((uploaded: number, total: number) => void),
  ) =>
    uploadFile(
      projectId,
      sessionId,
      file,
      typeof options === "function" ? { onProgress: options } : options,
    ),
};

export const scholar = {
  getPapers: (params: ScholarPaperListParams = {}, options?: RequestOptions) =>
    requestJson<{ papers: ScholarPaper[]; total: number }>(
      withQuery(`${SCHOLAR_API_BASE}/papers`, params),
      { signal: options?.signal },
    ),
  getPaper: (id: string, options?: RequestOptions) =>
    requestJson<{ paper: ScholarPaper & { content?: string; l3Conclusion?: string } }>(
      `${SCHOLAR_API_BASE}/papers/${pathSegment(id)}`,
      { signal: options?.signal },
    ),
  getPaperImages: (id: string, options?: RequestOptions) =>
    requestJson<{ images: string[] }>(`${SCHOLAR_API_BASE}/papers/${pathSegment(id)}/images`, {
      signal: options?.signal,
    }),
  getPaperContent: (id: string, params: ScholarPaperContentParams, options?: RequestOptions) =>
    requestJson<ScholarPaperContentResponse>(
      withQuery(`${SCHOLAR_API_BASE}/papers/${pathSegment(id)}/content`, params),
      { signal: options?.signal },
    ),
  getStats: (options?: RequestOptions) =>
    requestJson<ScholarStats>(`${SCHOLAR_API_BASE}/stats`, { signal: options?.signal }),
  search: (body: ScholarSearchBody, options?: RequestOptions) =>
    requestJson<{ results: ScholarPaper[]; mode: string; total: number }>(
      `${SCHOLAR_API_BASE}/search`,
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    ),
  getWorkspaces: (options?: RequestOptions) =>
    requestJson<{ workspaces: ScholarWorkspaceSummary[] }>(`${SCHOLAR_API_BASE}/workspaces`, {
      signal: options?.signal,
    }),
  getWorkspace: (name: string, options?: RequestOptions) =>
    requestJson<{ workspace: ScholarWorkspace }>(
      `${SCHOLAR_API_BASE}/workspaces/${pathSegment(name)}`,
      { signal: options?.signal },
    ),
  createWorkspace: (name: string) =>
    requestJson<{ workspace: ScholarWorkspace }>(`${SCHOLAR_API_BASE}/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  addPaperToWorkspace: (workspaceName: string, paperId: string) =>
    requestJson<{ ok: boolean }>(
      `${SCHOLAR_API_BASE}/workspaces/${pathSegment(workspaceName)}/papers`,
      {
        method: "POST",
        body: JSON.stringify({ paperId }),
      },
    ),
  getConfig: (options?: RequestOptions) =>
    requestJson<ScholarConfig>(`${SCHOLAR_API_BASE}/config`, { signal: options?.signal }),
  patchConfig: (patch: DeepPartial<ScholarConfig>, options?: RequestOptions) =>
    requestJson<ScholarConfig>(`${SCHOLAR_API_BASE}/config`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      signal: options?.signal,
    }),
  healthCheck: (scope: string, options?: RequestOptions) =>
    requestJson<HealthCheckResult>(`${SCHOLAR_API_BASE}/health/check`, {
      method: "POST",
      body: JSON.stringify({ scope }),
      signal: options?.signal,
    }),
  getTopics: (options?: RequestOptions) =>
    requestJson<ScholarTopicsOverview>(`${SCHOLAR_API_BASE}/analytics/topics`, {
      signal: options?.signal,
    }),
  getProjection: (options?: RequestOptions) =>
    requestJson<ScholarProjection>(`${SCHOLAR_API_BASE}/analytics/projection`, {
      signal: options?.signal,
    }),
  submitJob: (body: { kind: string; [key: string]: unknown }) =>
    requestJson<{ id: string; kind: string; status: string }>(`${SCHOLAR_API_BASE}/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getJobStream: () => new EventSource(`${SCHOLAR_API_BASE}/jobs/stream`),
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
  paperType?: string;
  match?: string;
  score?: number;
  /** First image filename in the paper's images/ directory, used as cover. */
  coverImage?: string | null;
}

export interface ScholarWorkspaceSummary {
  id: string;
  name: string;
  path: string;
  paperCount: number;
  createdAt: string;
}

export interface ScholarWorkspace extends ScholarWorkspaceSummary {
  papers: ScholarPaper[];
}

export interface ScholarTopic {
  id: number;
  keywords: string[];
  paperCount: number;
  name: string;
}

export interface ScholarTopicsOverview {
  built: boolean;
  topicCount?: number;
  topics: ScholarTopic[];
  computedAt?: string;
}

export interface ScholarProjectionPoint {
  id: string;
  x: number;
  y: number;
  topicId: number;
  year: number;
  title: string;
}

export interface ScholarProjection {
  built: boolean;
  stale: boolean;
  vectorCount?: number;
  currentVectorCount?: number;
  computedAt?: string;
  points: ScholarProjectionPoint[];
}

export interface FsEntry {
  name: string;
  isDir: boolean;
}

export interface FsBrowseResponse {
  path: string;
  entries: FsEntry[];
}

export const browseFsDirectory = (path: string, options?: RequestOptions) =>
  requestJson<FsBrowseResponse>(withQuery("/hub/fs/browse", { path }), { signal: options?.signal });

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
