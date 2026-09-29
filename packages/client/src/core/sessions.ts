import type {
  LiteratureRef,
  ProviderName,
  SessionAttachment,
  SessionDetail,
  SessionDirectoryListing,
  SessionFileContent,
  SessionInput,
  SessionMessage,
  SlashCommand,
} from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import {
  HttpError,
  UPLOAD_TIMEOUT_MS,
  decodeResponse,
  hubHeaders,
  hubHttp,
  pathSegment,
} from "./http";

/** 定义会话可调整的 Provider 执行选项。 */
export type SessionOptions = Partial<
  Pick<SessionDetail, "model" | "permissionMode" | "thinking" | "effort">
>;

/** 新会话：Provider、执行选项、工作目录、引用的文献与首条消息。 */
export interface NewSession extends Omit<SessionOptions, "model"> {
  provider: ProviderName;
  model?: string;
  /** 会话运行的目录；不给出时服务端为它建一个自己的目录。 */
  cwd?: string;
  references: LiteratureRef[];
  message: SessionInput;
}

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
  /** 新会话的命令按 Provider 与目录列出，已有会话的按它自己的。 */
  commands: (provider: ProviderName, sessionId?: string, signal?: AbortSignal, cwd?: string) =>
    hubHttp.json<{ commands: SlashCommand[] }>(
      sessionId
        ? `/sessions/${pathSegment(sessionId)}/commands`
        : `/sessions/commands?${new URLSearchParams({ provider, ...(cwd ? { cwd } : {}) })}`,
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
  get: (id: string, signal?: AbortSignal) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}`, { signal }),
  /** 以首条消息创建会话；Provider 为它命名后返回，首轮已在运行。 */
  create: (session: NewSession) =>
    hubHttp.json<SessionDetail>("/sessions", { method: "POST", json: session }),
  options: (id: string, options: SessionOptions) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}/options`, {
      method: "PATCH",
      json: options,
    }),
  enqueue: (id: string, input: SessionInput) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}/queue`, {
      method: "POST",
      json: input,
    }),
  editQueue: (id: string, action: "resume" | "remove", messageId?: string) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}/queue`, {
      method: "PATCH",
      json: { action, messageId },
    }),
  /** 从指定消息之前的历史或完整历史创建分叉会话。 */
  fork: (id: string, messageId?: string) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}/fork`, {
      method: "POST",
      json: { messageId },
    }),
  /** 重命名或归档；归档的会话不再出现在列表中，Provider 的文件不变。 */
  update: (id: string, fields: { title?: string; archived?: boolean }) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}`, {
      method: "PATCH",
      json: fields,
    }),
  /** 整体替换会话引用的文献。 */
  setReferences: (id: string, references: LiteratureRef[]) =>
    hubHttp.json<SessionDetail>(`/sessions/${pathSegment(id)}/references`, {
      method: "PUT",
      json: { references },
    }),
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

/** 构造会话详情页面地址；会话 id 中的冒号保持可读。 */
export function sessionUrl(id: string): string {
  return `/sessions/${encodeURIComponent(id).replace("%3A", ":")}`;
}

/** 引用在地址中的写法：`paper:<id>`、`collection:<id>`，逗号分隔。 */
export function formatReferences(references: LiteratureRef[]): string {
  return references.map((ref) => `${ref.kind}:${ref.id}`).join(",");
}

/** 读回 `formatReferences` 写下的引用，丢弃无法识别的项。 */
export function parseReferences(value: string | null): LiteratureRef[] {
  const references: LiteratureRef[] = [];
  for (const item of (value ?? "").split(",")) {
    const at = item.indexOf(":");
    const kind = item.slice(0, at);
    const id = item.slice(at + 1);
    if (at > 0 && id && (kind === "paper" || kind === "collection"))
      if (!references.some((ref) => ref.kind === kind && ref.id === id))
        references.push({ kind, id });
  }
  return references;
}

/** 构造新会话地址：可指定项目、引用的文献，以及预先填入的研究技能。 */
export function newSessionUrl(
  options: { project?: string; references?: LiteratureRef[]; skill?: string } = {},
) {
  const params = new URLSearchParams();
  if (options.project) params.set("project", options.project);
  if (options.references?.length) params.set("refs", formatReferences(options.references));
  if (options.skill) params.set("skill", options.skill);
  return `/sessions${params.size ? `?${params}` : ""}`;
}

/** 构造 AI SDK 消息发送和流订阅接口地址。 */
export function chatPaths(id: string) {
  const base = `/api/sessions/${pathSegment(id)}`;
  return { messages: `${base}/messages`, stream: `${base}/stream` };
}

/** 查询会话消息、运行状态、待处理交互和执行选项。 */
export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: ({ signal }) => sessionApi.get(id, signal),
  });

/** 会话工作目录里的一个文件；agent 随时可能改它，所以每次打开都重新读取。 */
export const sessionFileQuery = (id: string, path: string) =>
  queryOptions({
    queryKey: ["session-file", id, path],
    queryFn: ({ signal }) => sessionApi.file(id, path, signal),
    staleTime: 0,
    gcTime: 60_000,
  });

/** 判断会话是否正在运行或等待用户输入。 */
export function isSessionActive(state: SessionDetail["state"] | undefined): boolean {
  return state === "running" || state === "waiting-input";
}

/** 将会话消息转换为即时发送、排队和首条消息共用的输入。 */
export function sessionInput(
  sessionId: string,
  message: SessionMessage,
  references: LiteratureRef[] = [],
): SessionInput {
  return {
    id: message.id,
    text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    attachmentIds: ownAttachments(sessionId, message).map((file) => file.id),
    references,
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
