import type {
  AgentActivity,
  AppSessionSummary,
  InputRequest,
  PendingInputType,
  PermissionMode,
  ProviderName,
  ThinkingOption,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { api as coreApi } from "../../../core/api";
import type { ProviderGroupFilter, RequestOptions } from "../../../core/api";
import { requestJson } from "../../../core/http";
import type { ProcessSummary, SessionDetail, SessionMetadataDetail } from "../../../core/types";
import type { PatchHunk } from "../components/renderers/tools/types";
import type { AgentSession, Session, SessionStatus } from "../types";

export type { UploadedFile } from "@scholaraio-hub/shared";

export interface PaginationInfo {
  hasOlderMessages: boolean;
  totalMessageCount: number;
  returnedMessageCount: number;
  truncatedBeforeMessageId?: string;
  totalCompactions: number;
}

export interface GlobalSessionItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  provider: ProviderName;
  projectId: string;
  projectName: string;
  ownership: SessionStatus;
  pendingInputType?: PendingInputType;
  activity?: AgentActivity;
  hasUnread?: boolean;
  customTitle?: string;
  isArchived?: boolean;
  isStarred?: boolean;
  executor?: string;
  model?: string;
}

export interface GlobalSessionStats {
  totalCount: number;
  unreadCount: number;
  starredCount: number;
  archivedCount: number;
  providerCounts: Partial<Record<ProviderName, number>>;
  executorCounts: Record<string, number>;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface GlobalSessionsResponse {
  sessions: GlobalSessionItem[];
  hasMore: boolean;
  stats: GlobalSessionStats;
  projects: ProjectOption[];
}

export interface ProcessInfo {
  id: string;
  sessionId: string;
  projectId: string;
  state: string;
  startedAt: string;
  provider: ProviderName;
  model?: string;
  executor?: string;
}

export interface SessionOptions {
  mode?: PermissionMode;
  model?: string;
  thinking?: ThinkingOption;
  provider?: ProviderName;
  executor?: string;
}

const DEFAULT_STATS: GlobalSessionStats = {
  totalCount: 0,
  unreadCount: 0,
  starredCount: 0,
  archivedCount: 0,
  providerCounts: {},
  executorCounts: {},
};

function sessionMatchesProviderGroup(
  provider: ProviderName,
  filter?: ProviderGroupFilter,
): boolean {
  if (!filter) return true;
  if (filter === "claude") return provider === "claude" || provider === "claude-ollama";
  return provider === "codex" || provider === "codex-oss";
}

async function fetchGlobalSessions(
  params?: {
    project?: string;
    q?: string;
    after?: string;
    limit?: number;
    includeArchived?: boolean;
    starred?: boolean;
    includeStats?: boolean;
    provider?: ProviderGroupFilter;
  },
  options?: RequestOptions,
): Promise<GlobalSessionsResponse> {
  const qs = new URLSearchParams();
  if (params?.project) qs.set("project", params.project);
  if (params?.q) qs.set("q", params.q);
  if (params?.after) qs.set("after", params.after);
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.includeArchived) qs.set("includeArchived", "1");
  if (params?.starred) qs.set("starred", "1");
  if (params?.provider) qs.set("provider", params.provider);
  const suffix = qs.toString();
  const data = await requestJson<{
    sessions: AppSessionSummary[];
    hasMore: boolean;
    stats: GlobalSessionStats;
    projects: ProjectOption[];
  }>(`/api/sessions${suffix ? `?${suffix}` : ""}`, { signal: options?.signal });

  // Server already enriches sessions, but its rows are SessionSummary-shaped
  // (with extra projectName attached). Map to GlobalSessionItem.
  const projectsById = new Map(data.projects.map((p) => [p.id, p.name]));
  const sessions: GlobalSessionItem[] = data.sessions
    .filter((session) => sessionMatchesProviderGroup(session.provider, params?.provider))
    .map((session) => {
      const withName = session as AppSessionSummary & { projectName?: string };
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        provider: session.provider,
        projectId: session.projectId,
        projectName:
          withName.projectName ?? projectsById.get(session.projectId) ?? session.projectId,
        ownership: session.ownership,
        pendingInputType: session.pendingInputType,
        activity: session.activity,
        hasUnread: session.hasUnread,
        customTitle: session.customTitle,
        isArchived: session.isArchived,
        isStarred: session.isStarred,
        executor: session.executor,
        model: session.model,
      };
    });

  return {
    sessions,
    hasMore: data.hasMore,
    stats: { ...DEFAULT_STATS, ...data.stats },
    projects: data.projects,
  };
}

export const api = {
  ...coreApi,

  getSession: (
    projectId: string,
    sessionId: string,
    afterMessageId?: string,
    options?: { tailCompactions?: number; beforeMessageId?: string },
  ) => {
    const params = new URLSearchParams();
    if (afterMessageId) params.set("afterMessageId", afterMessageId);
    if (options?.tailCompactions !== undefined) {
      params.set("tailCompactions", String(options.tailCompactions));
    }
    if (options?.beforeMessageId) params.set("beforeMessageId", options.beforeMessageId);
    const qs = params.toString();
    return requestJson<SessionDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}${qs ? `?${qs}` : ""}`,
    );
  },

  getSessionMetadata: (projectId: string, sessionId: string) =>
    requestJson<
      Omit<SessionMetadataDetail, "session" | "ownership"> & {
        session: Session;
        ownership: SessionStatus & Pick<SessionMetadataDetail["ownership"], "state">;
      }
    >(`/api/projects/${projectId}/sessions/${sessionId}/metadata`),

  getAgentSession: (projectId: string, sessionId: string, agentId: string) =>
    requestJson<AgentSession>(`/api/projects/${projectId}/sessions/${sessionId}/agents/${agentId}`),

  getAgentMappings: (projectId: string, sessionId: string) =>
    requestJson<{ mappings: Array<{ toolUseId: string; agentId: string; agentType?: string }> }>(
      `/api/projects/${projectId}/sessions/${sessionId}/agents`,
    ),

  startSession: (
    projectId: string,
    message: string,
    options?: SessionOptions,
    attachments?: UploadedFile[],
  ) =>
    requestJson<{
      sessionId: string;
      processId: string;
      permissionMode: PermissionMode;
      modeVersion: number;
    }>(`/api/projects/${projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        message,
        mode: options?.mode,
        model: options?.model,
        thinking: options?.thinking,
        provider: options?.provider,
        executor: options?.executor,
        attachments,
      }),
    }),

  createSession: (projectId: string, options?: SessionOptions) =>
    requestJson<{
      sessionId: string;
      processId: string;
      permissionMode: PermissionMode;
      modeVersion: number;
    }>(`/api/projects/${projectId}/sessions/create`, {
      method: "POST",
      body: JSON.stringify({
        mode: options?.mode,
        model: options?.model,
        thinking: options?.thinking,
        provider: options?.provider,
        executor: options?.executor,
      }),
    }),

  resumeSession: (
    projectId: string,
    sessionId: string,
    message: string,
    options?: SessionOptions,
    attachments?: UploadedFile[],
    tempId?: string,
  ) =>
    requestJson<{
      processId: string;
      permissionMode: PermissionMode;
      modeVersion: number;
    }>(`/api/projects/${projectId}/sessions/${sessionId}/resume`, {
      method: "POST",
      body: JSON.stringify({
        message,
        mode: options?.mode,
        model: options?.model,
        thinking: options?.thinking,
        provider: options?.provider,
        executor: options?.executor,
        attachments,
        tempId,
      }),
    }),

  queueMessage: (
    sessionId: string,
    message: string,
    mode?: PermissionMode,
    attachments?: UploadedFile[],
    tempId?: string,
    thinking?: ThinkingOption,
    deferred?: boolean,
  ) =>
    requestJson<{
      queued: boolean;
      restarted?: boolean;
      processId?: string;
      deferred?: boolean;
    }>(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        message,
        mode,
        attachments,
        tempId,
        thinking,
        deferred,
      }),
    }),

  cancelDeferredMessage: (sessionId: string, tempId: string) =>
    requestJson<{ cancelled: boolean }>(
      `/api/sessions/${sessionId}/deferred/${encodeURIComponent(tempId)}`,
      { method: "DELETE" },
    ),

  markSessionSeen: (sessionId: string, messageId?: string) =>
    requestJson<{ marked: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),

  markSessionUnread: (sessionId: string) =>
    requestJson<{ marked: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
      method: "DELETE",
    }),

  getGlobalSessions: (
    params?: {
      project?: string;
      q?: string;
      after?: string;
      limit?: number;
      includeArchived?: boolean;
      starred?: boolean;
      includeStats?: boolean;
      provider?: ProviderGroupFilter;
    },
    options?: RequestOptions,
  ) => fetchGlobalSessions(params, options),

  getGlobalSessionStats: async (options?: RequestOptions) => ({
    stats: (await fetchGlobalSessions(undefined, options)).stats,
  }),

  getProcesses: () =>
    requestJson<{ processes: ProcessSummary[]; terminatedProcesses?: ProcessSummary[] }>(
      "/api/processes?includeTerminated=true",
    ),

  expandDiffContext: (
    projectId: string,
    filePath: string,
    oldString: string,
    newString: string,
    originalFile: string,
  ) =>
    requestJson<{ structuredPatch: PatchHunk[]; diffHtml: string }>(
      `/api/projects/${projectId}/diff/expand`,
      {
        method: "POST",
        body: JSON.stringify({ filePath, oldString, newString, originalFile }),
      },
    ),

  cloneSession: (projectId: string, sessionId: string) =>
    requestJson<{ session: AppSessionSummary }>(
      `/api/projects/${projectId}/sessions/${sessionId}/clone`,
      { method: "POST" },
    ),

  getProcessInfo: (sessionId: string) =>
    requestJson<{ process: ProcessInfo | null }>(`/api/sessions/${sessionId}/process`),
};
