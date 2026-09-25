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
import { hubHeaders, pathSegment, requestJson } from "./http";

/** Execution options a session can change, in the provider's own terms. */
export type SessionOptions = Partial<
  Pick<StoredSession, "model" | "permissionMode" | "thinking" | "effort">
>;

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
      hubHeaders().forEach((value, name) => request.setRequestHeader(name, value));
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
  /**
   * Start a new session's first turn from the new-chat page. The body is the
   * one the chat stream sends (`sessionInput`); only the stream is let go of,
   * for the session page to resume.
   */
  async sendFirstMessage(id: string, input: SessionInput): Promise<void> {
    try {
      const response = await fetch(chatPaths(id).messages, {
        method: "POST",
        headers: hubHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      });
      if (!response.ok)
        throw new Error(`首条消息提交失败 (${response.status})：${await response.text()}`);
      // The server owns the run. The conversation page resumes the same stream.
      await response.body?.cancel();
    } catch (error) {
      // A lost response can still have accepted the input. Check its stable ID
      // before allowing a retry, so the first turn is never duplicated.
      const current = await sessionApi.get(id);
      if (!current.messages.some((message) => message.id === input.id)) throw error;
    }
  },
  commands: (provider: ProviderName, sessionId?: string, signal?: AbortSignal) =>
    requestJson<{ commands: SlashCommand[] }>(
      sessionId
        ? `/api/sessions/${pathSegment(sessionId)}/commands`
        : `/api/sessions/commands?provider=${provider}`,
      { signal },
    ),
  browseFiles: (id: string, relative = "", signal?: AbortSignal) =>
    requestJson<SessionDirectoryListing>(
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
    provider: ProviderName,
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
  /** A new session holding this one through the turn `messageId` starts, or all of it. */
  fork: (id: string, messageId?: string) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}/fork`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),
  rename: (id: string, title: string) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  /** Stop and remove a session; the provider's own transcript is left alone. */
  remove: (id: string) =>
    requestJson<void>(`/api/sessions/${pathSegment(id)}`, { method: "DELETE" }),
  /** Drop the user turn `messageId` and everything after it, before sending an edit. */
  rewind: (id: string, messageId: string) =>
    requestJson<StoredSession>(`/api/sessions/${pathSegment(id)}/rewind`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
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

/** An open session's page. */
export function sessionUrl(id: string): string {
  return `/sessions/${encodeURIComponent(id)}`;
}

/** A new chat, optionally in a workspace and about some papers. */
export function newSessionUrl(projectId?: string, paperIds: string[] = []) {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (paperIds.length) params.set("papers", paperIds.join(","));
  return `/sessions${params.size ? `?${params}` : ""}`;
}

/**
 * The endpoints the chat stream talks to itself: the AI SDK transport does its
 * own fetch, so it takes paths rather than going through `sessionApi`.
 */
export function chatPaths(id: string) {
  const base = `/api/sessions/${pathSegment(id)}`;
  return { messages: `${base}/messages`, stream: `${base}/stream` };
}

/** Every session, for the sidebar and the workspace list. */
export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: ({ signal }) => sessionApi.list(signal),
});

/** One session's snapshot: its messages, run state, pending decision and options. */
export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: ({ signal }) => sessionApi.get(id, signal),
  });

/** A turn is running, or waiting on the user to decide something. */
export function isSessionActive(state: StoredSession["state"] | undefined): boolean {
  return state === "running" || state === "waiting-input";
}

/** A message the chat sends, as every way of sending one takes it: now, queued, or first. */
export function sessionInput(sessionId: string, message: SessionMessage): SessionInput {
  return {
    id: message.id,
    text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    attachmentIds: ownAttachments(sessionId, message).map((file) => file.id),
  };
}

/**
 * The files of a sent message that are this session's own uploads, so an
 * edited prompt can send them again.
 */
export function ownAttachments(sessionId: string, message: SessionMessage): SessionAttachment[] {
  const own = `${attachmentsPath({ sessionId })}/`;
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
