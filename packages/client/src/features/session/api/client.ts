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
import type { ProcessSummary, ProjectSummary, SessionDetail } from "../../../core/types";
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

function toGlobalSession(
  session: AppSessionSummary,
  projects: ProjectSummary[],
): GlobalSessionItem {
  const project = projects.find((item) => item.id === session.projectId);
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    provider: session.provider,
    projectId: session.projectId,
    projectName: project?.name ?? project?.path ?? session.projectId,
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
}

async function getProjectSessionsAsGlobal(params?: {
  project?: string;
  q?: string;
  after?: string;
  limit?: number;
  includeArchived?: boolean;
  starred?: boolean;
}): Promise<GlobalSessionsResponse> {
  const { projects } = await coreApi.getProjects();
  const selectedProjects = params?.project
    ? projects.filter((project) => project.id === params.project)
    : projects;
  const allSessions = (
    await Promise.all(
      selectedProjects.map((project) =>
        coreApi
          .getProjectSessions(project.id)
          .then(({ sessions }) => sessions.map((session) => toGlobalSession(session, projects)))
          .catch(() => []),
      ),
    )
  ).flat();

  const query = params?.q?.trim().toLowerCase();
  const filtered = allSessions
    .filter((session) => (params?.includeArchived ? true : !session.isArchived))
    .filter((session) => (params?.starred ? session.isStarred : true))
    .filter((session) => {
      if (!query) return true;
      const title = session.customTitle ?? session.title ?? "";
      return (
        title.toLowerCase().includes(query) || session.projectName.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const afterIndex = params?.after
    ? filtered.findIndex((session) => session.updatedAt === params.after)
    : -1;
  const start = afterIndex >= 0 ? afterIndex + 1 : 0;
  const limit = params?.limit ?? 50;
  const page = filtered.slice(start, start + limit);

  return {
    sessions: page,
    hasMore: start + limit < filtered.length,
    stats: {
      ...DEFAULT_STATS,
      totalCount: filtered.length,
      unreadCount: filtered.filter((session) => session.hasUnread).length,
      starredCount: filtered.filter((session) => session.isStarred).length,
      archivedCount: allSessions.filter((session) => session.isArchived).length,
    },
    projects: projects.map((project) => ({ id: project.id, name: project.name ?? project.path })),
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
    return request<SessionDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}${qs ? `?${qs}` : ""}`,
    );
  },

  getSessionMetadata: (projectId: string, sessionId: string) =>
    request<{
      session: Session;
      ownership: SessionStatus;
      pendingInputRequest?: InputRequest | null;
      slashCommands?: Array<{ name: string; description?: string }> | null;
    }>(`/api/projects/${projectId}/sessions/${sessionId}/metadata`),

  getAgentSession: (projectId: string, sessionId: string, agentId: string) =>
    request<AgentSession>(`/api/projects/${projectId}/sessions/${sessionId}/agents/${agentId}`),

  getAgentMappings: (projectId: string, sessionId: string) =>
    request<{ mappings: Array<{ toolUseId: string; agentId: string; agentType?: string }> }>(
      `/api/projects/${projectId}/sessions/${sessionId}/agents`,
    ),

  startSession: (
    projectId: string,
    message: string,
    options?: SessionOptions,
    attachments?: UploadedFile[],
  ) =>
    request<{
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
    request<{
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
    request<{
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
    request<{
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
    request<{ cancelled: boolean }>(`/api/sessions/${sessionId}/deferred/${tempId}`, {
      method: "DELETE",
    }),

  markSessionSeen: (sessionId: string, messageId?: string) =>
    request<{ success: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),

  markSessionUnread: (sessionId: string) =>
    request<{ success: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
      method: "DELETE",
    }),

  getGlobalSessions: (params?: {
    project?: string;
    q?: string;
    after?: string;
    limit?: number;
    includeArchived?: boolean;
    starred?: boolean;
    includeStats?: boolean;
  }) => getProjectSessionsAsGlobal(params),

  getGlobalSessionStats: async () => ({ stats: (await getProjectSessionsAsGlobal()).stats }),

  getProcesses: () =>
    request<{ processes: ProcessSummary[]; terminatedProcesses?: ProcessSummary[] }>(
      "/api/processes?includeTerminated=true",
    ),

  expandDiffContext: (
    projectId: string,
    filePath: string,
    oldString: string,
    newString: string,
    originalFile: string,
  ) =>
    request<{ structuredPatch: PatchHunk[]; diffHtml: string }>(
      `/api/projects/${projectId}/diff/expand`,
      {
        method: "POST",
        body: JSON.stringify({ filePath, oldString, newString, originalFile }),
      },
    ),
};
