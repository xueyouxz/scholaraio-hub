import type {
  ProviderName,
  SessionAttachment,
  SessionDirectoryListing,
  SessionFileContent,
  SessionInput,
  SessionMessage,
  SlashCommand,
  StoredSession,
} from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import {
  HttpError,
  UPLOAD_TIMEOUT_MS,
  decodeResponse,
  hubHeaders,
  hubHttp,
  pathSegment,
  readJsonResponse,
} from "./http";

/** 定义会话可调整的 Provider 执行选项。 */
export type SessionOptions = Partial<
  Pick<StoredSession, "model" | "permissionMode" | "thinking" | "effort">
>;

/** 指定附件所属会话或新会话的草稿区。 */
export type AttachmentTarget = { sessionId: string } | "draft";

const attachmentsPath = (target: AttachmentTarget) =>
  target === "draft"
    ? "/sessions/draft-attachments"
    : `/sessions/${pathSegment(target.sessionId)}/attachments`;

export const sessionApi = {
  /** 上传单个附件，报告上传进度并处理取消和超时。 */
  uploadAttachment(
    target: AttachmentTarget,
    file: File,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<SessionAttachment> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", hubHttp.url(attachmentsPath(target)));
      hubHeaders().forEach((value, name) => request.setRequestHeader(name, value));
      request.responseType = "json";
      request.timeout = UPLOAD_TIMEOUT_MS;
      request.ontimeout = () => reject(new HttpError("Upload timed out", 0, "REQUEST_TIMEOUT"));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onload = () => {
        try {
          resolve(
            decodeResponse<SessionAttachment>(
              request.response,
              request.status,
              request.getResponseHeader("X-Request-ID") ?? undefined,
            ),
          );
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () =>
        reject(new HttpError("Attachment upload failed: network error", 0, "NETWORK_ERROR"));
      request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      const abort = () => request.abort();
      request.onloadend = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      const body = new FormData();
      body.set("file", file);
      request.send(body);
    });
  },
  /** 删除尚未发送的已上传附件。 */
  removeAttachment: (target: AttachmentTarget, attachmentId: string) =>
    hubHttp.json<void>(`${attachmentsPath(target)}/${pathSegment(attachmentId)}`, {
      method: "DELETE",
    }),
  /** 提交首条消息并释放响应流，失败时按消息标识核对接收状态。 */
  async sendFirstMessage(id: string, input: SessionInput): Promise<void> {
    try {
      await hubHttp.read(
        `/sessions/${pathSegment(id)}/messages`,
        {
          method: "POST",
          json: input,
        },
        async (response) => {
          if (!response.ok) await readJsonResponse<never>(response);
          await response.body?.cancel();
        },
      );
    } catch (error) {
      // 按消息标识查询会话中的实际接收状态。
      const current = await sessionApi.get(id);
      if (!current.messages.some((message) => message.id === input.id)) throw error;
    }
  },
  commands: (provider: ProviderName, sessionId?: string, signal?: AbortSignal) =>
    hubHttp.json<{ commands: SlashCommand[] }>(
      sessionId
        ? `/sessions/${pathSegment(sessionId)}/commands`
        : `/sessions/commands?provider=${provider}`,
      { signal },
    ),
  browseFiles: (id: string, relative = "", signal?: AbortSignal) =>
    hubHttp.json<SessionDirectoryListing>(
      `/sessions/${pathSegment(id)}/fs/browse?path=${encodeURIComponent(relative)}`,
      { signal },
    ),
  file: (id: string, relative: string, signal?: AbortSignal) =>
    hubHttp.json<SessionFileContent>(
      `/sessions/${pathSegment(id)}/fs/file?path=${encodeURIComponent(relative)}`,
      { signal },
    ),
  list: (signal?: AbortSignal) =>
    hubHttp.json<{ sessions: StoredSession[] }>("/sessions", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}`, { signal }),
  create: (
    provider: ProviderName,
    paperIds: string[] = [],
    model?: string,
    projectId?: string,
    execution?: Omit<SessionOptions, "model">,
    /** 由新会话接收的草稿附件标识。 */
    attachmentIds: string[] = [],
  ) =>
    hubHttp.json<StoredSession>("/sessions", {
      method: "POST",
      json: { provider, paperIds, model, projectId, ...execution, attachmentIds },
    }),
  options: (id: string, options: SessionOptions) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}/options`, {
      method: "PATCH",
      json: options,
    }),
  enqueue: (id: string, input: SessionInput) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}/queue`, {
      method: "POST",
      json: input,
    }),
  editQueue: (id: string, action: "resume" | "remove", messageId?: string) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}/queue`, {
      method: "PATCH",
      json: { action, messageId },
    }),
  /** 从指定消息之前的历史或完整历史创建分叉会话。 */
  fork: (id: string, messageId?: string) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}/fork`, {
      method: "POST",
      json: { messageId },
    }),
  rename: (id: string, title: string) =>
    hubHttp.json<StoredSession>(`/sessions/${pathSegment(id)}`, {
      method: "PATCH",
      json: { title },
    }),
  /** 停止并删除应用会话，保留 Provider 原生记录。 */
  remove: (id: string) => hubHttp.json<void>(`/sessions/${pathSegment(id)}`, { method: "DELETE" }),
  stop: (id: string) => hubHttp.json(`/sessions/${pathSegment(id)}/stop`, { method: "POST" }),
  input: (
    id: string,
    requestId: string,
    decision: "approve" | "approve_accept_edits" | "deny",
    answers?: Record<string, string>,
  ) =>
    hubHttp.json(`/sessions/${pathSegment(id)}/input`, {
      method: "POST",
      json: { requestId, decision, answers },
    }),
};

/** 构造会话详情页面地址。 */
export function sessionUrl(id: string): string {
  return `/sessions/${encodeURIComponent(id)}`;
}

/** 构造带有可选项目和文献上下文的新会话地址。 */
export function newSessionUrl(projectId?: string, paperIds: string[] = []) {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (paperIds.length) params.set("papers", paperIds.join(","));
  return `/sessions${params.size ? `?${params}` : ""}`;
}

/** 构造 AI SDK 消息发送和流订阅接口地址。 */
export function chatPaths(id: string) {
  const base = `/api/sessions/${pathSegment(id)}`;
  return { messages: `${base}/messages`, stream: `${base}/stream` };
}

/** 定义侧栏和工作区共用的会话列表查询。 */
export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: ({ signal }) => sessionApi.list(signal),
});

/** 查询会话消息、运行状态、待处理交互和执行选项。 */
export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: ({ signal }) => sessionApi.get(id, signal),
  });

/** 判断会话是否正在运行或等待用户输入。 */
export function isSessionActive(state: StoredSession["state"] | undefined): boolean {
  return state === "running" || state === "waiting-input";
}

/** 将会话消息转换为即时发送、排队和首条消息共用的输入。 */
export function sessionInput(sessionId: string, message: SessionMessage): SessionInput {
  return {
    id: message.id,
    text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    attachmentIds: ownAttachments(sessionId, message).map((file) => file.id),
  };
}

/** 提取消息中属于当前会话的已上传附件。 */
export function ownAttachments(sessionId: string, message: SessionMessage): SessionAttachment[] {
  const own = `${hubHttp.url(attachmentsPath({ sessionId }))}/`;
  return message.parts.flatMap((part) =>
    part.type === "file" && part.url.startsWith(own)
      ? [
          {
            id: decodeURIComponent(part.url.slice(own.length)),
            filename: part.filename ?? "",
            mediaType: part.mediaType,
            size: 0,
            url: part.url,
          },
        ]
      : [],
  );
}
