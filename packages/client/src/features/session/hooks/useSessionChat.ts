import { useChat } from "@ai-sdk/react";
import type { SessionAttachment, SessionDetail, SessionMessage } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { hubHeaders } from "../../../core/http";
import { PROJECTS_KEY } from "../../../core/projects";
import {
  chatPaths,
  isSessionActive,
  sessionApi,
  sessionInput,
  sessionQuery,
} from "../../../core/sessions";

/** How often to re-read the snapshot while a turn runs without our stream. */
const POLL_MS = 1000;
/** While our stream is open it pushes state changes; poll only as a safety net. */
const STREAMING_POLL_MS = 5000;

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "idle";

/**
 * One open session's data. Messages stream through the AI SDK `useChat` hook
 * against the app-owned session API. Everything else (run state, the pending
 * decision, the queue, options) lives in the session snapshot query: the stream
 * pushes state changes into it, and it is polled while a turn runs elsewhere.
 */
export function useSessionChat(initial: SessionDetail) {
  const id = initial.id;
  const client = useQueryClient();
  // useChat reports failures through onError, not the sendMessage promise;
  // send() reads this afterwards so the composer keeps a draft that failed.
  const sendError = useRef<Error | undefined>(undefined);
  /**
   * Resolves once the server has taken the message. `sendMessage` only settles
   * when the whole turn has streamed, which is far too late for the composer:
   * it would hold the draft and its "sending" state for the entire answer.
   */
  const accepted = useRef<{ resolve: () => void; reject: (error: Error) => void } | undefined>(
    undefined,
  );
  const snapshotKey = sessionQuery(id).queryKey;
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: sessionQuery(id).queryKey });
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
  }, [client, id]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<SessionMessage>({
        api: chatPaths(id).messages,
        headers: Object.fromEntries(hubHeaders()),
        // The server keeps history; send only the newest user turn (stable id for idempotency).
        // A replaced message (`sendMessage` with its id) corrects the last prompt.
        prepareSendMessagesRequest: ({ messages, messageId }) => {
          const message = messages.at(-1);
          if (!message) return { body: {} };
          return {
            body: { ...sessionInput(id, message), ...(messageId ? { replaces: messageId } : {}) },
          };
        },
        prepareReconnectToStreamRequest: () => ({ api: chatPaths(id).stream }),
      }),
    [id],
  );
  const chat = useChat<SessionMessage>({
    id,
    messages: initial.messages,
    transport,
    resume: isSessionActive(initial.state),
    onFinish: refresh,
    onError: (error) => {
      sendError.current = error;
      accepted.current?.reject(error);
      refresh();
    },
    onData: (part) => {
      if (part.type !== "data-session-state") return;
      client.setQueryData(snapshotKey, (current) =>
        current
          ? { ...current, state: part.data.state, pendingInput: part.data.pendingInput }
          : current,
      );
    },
    throttle: 50,
  });
  const streaming = chat.status === "submitted" || chat.status === "streaming";
  // The first chunk means the turn is running; the composer is free again.
  useEffect(() => {
    if (chat.status === "streaming" || chat.status === "ready") accepted.current?.resolve();
  }, [chat.status]);

  const snapshot = useQuery({
    ...sessionQuery(id),
    refetchInterval: (query) => {
      if (chat.status === "streaming") return STREAMING_POLL_MS;
      return streaming || isSessionActive(query.state.data?.state) ? POLL_MS : false;
    },
  });

  // Reconcile the stream with the snapshot:
  // - a run started elsewhere (other tab, queued turn) → adopt its messages and attach;
  // - a run that finished without an onFinish here → replace with the settled messages.
  const resumedInput = useRef<string | undefined>(undefined);
  const synchronizedVersion = useRef(initial.updatedAt);
  useEffect(() => {
    const current = snapshot.data;
    if (!current || streaming) return;
    if (isSessionActive(current.state)) {
      const userId = current.messages.filter((message) => message.role === "user").at(-1)?.id;
      if (
        userId &&
        !chat.messages.some((message) => message.id === userId) &&
        resumedInput.current !== userId
      ) {
        resumedInput.current = userId;
        chat.setMessages(current.messages);
        void chat.resumeStream().catch((error) => {
          sendError.current = error;
          refresh();
        });
      }
      return;
    }
    if (synchronizedVersion.current === current.updatedAt) return;
    // A fast first turn can finish between the initial GET and stream resume
    // (204). In that case no onFinish fires: reconcile the settled snapshot.
    synchronizedVersion.current = current.updatedAt;
    chat.setMessages(current.messages);
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
  }, [
    snapshot.data,
    streaming,
    chat.setMessages,
    chat.messages,
    chat.resumeStream,
    client,
    refresh,
  ]);

  const stop = useMutation({ mutationFn: () => sessionApi.stop(id), onSuccess: refresh });
  const reconnect = useMutation({
    mutationFn: async () => {
      const current = await sessionApi.get(id);
      chat.setMessages(current.messages);
      chat.clearError();
      if (isSessionActive(current.state)) await chat.resumeStream();
      refresh();
    },
  });
  const editQueue = useMutation({
    mutationFn: ({ action, messageId }: { action: "resume" | "remove"; messageId?: string }) =>
      sessionApi.editQueue(id, action, messageId),
    onSuccess: refresh,
  });
  const changeOptions = useMutation({
    mutationFn: (options: Parameters<typeof sessionApi.options>[1]) =>
      sessionApi.options(id, options),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: snapshotKey });
    },
  });

  /**
   * Send a prompt. With `replaces` it corrects the session's last prompt: the
   * AI SDK swaps that message for this one and drops the reply, and the server
   * takes the turn back and runs this one in its place.
   */
  const send = async (text: string, attachments: SessionAttachment[], replaces?: string) => {
    sendError.current = undefined;
    chat.clearError();
    const taken = new Promise<void>((resolve, reject) => {
      accepted.current = { resolve, reject };
    });
    const streamed = chat
      .sendMessage({
        text,
        files: attachments.map((file) => ({
          type: "file",
          mediaType: file.mediaType,
          filename: file.filename,
          url: file.url,
        })),
        messageId: replaces,
      })
      .then(
        () => accepted.current?.resolve(),
        (error: Error) => accepted.current?.reject(error),
      );
    void streamed;
    try {
      await taken;
    } finally {
      accepted.current = undefined;
    }
    if (sendError.current) {
      // The correction was refused, but the transcript here already dropped the turn.
      if (replaces) chat.setMessages((await sessionApi.get(id)).messages);
      throw sendError.current;
    }
  };

  /** Continue from the turn `messageId` starts, in a new session. */
  const fork = useMutation({
    mutationFn: (messageId: string) => sessionApi.fork(id, messageId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });

  // Reuse the message id when a lost enqueue response is retried with the same content.
  const queueSubmission = useRef<{ signature: string; id: string } | undefined>(undefined);
  const enqueue = async (text: string, attachments: SessionAttachment[]) => {
    const attachmentIds = attachments.map((file) => file.id);
    const signature = JSON.stringify([text, attachmentIds]);
    if (queueSubmission.current?.signature !== signature)
      queueSubmission.current = { signature, id: crypto.randomUUID() };
    await sessionApi.enqueue(id, {
      id: queueSubmission.current.id,
      text,
      attachmentIds,
      references: [],
    });
    queueSubmission.current = undefined;
    refresh();
  };

  const state = snapshot.data?.state ?? initial.state;
  const running = streaming || isSessionActive(state);
  const connection: ConnectionStatus = chat.error
    ? "disconnected"
    : chat.status === "streaming"
      ? "connected"
      : running
        ? "connecting"
        : "idle";

  return {
    messages: chat.messages,
    snapshot: snapshot.data,
    /** Our own stream is open (submitted or streaming). */
    streaming,
    /** A turn is running, here or elsewhere. */
    running,
    state,
    connection,
    failure: chat.error ?? stop.error ?? reconnect.error ?? editQueue.error ?? fork.error,
    refresh,
    send,
    fork,
    enqueue,
    stop,
    reconnect,
    editQueue,
    changeOptions,
  };
}
