import type { InputRequest, PermissionMode, SessionOwnership } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../core/api";
import type { SessionDetail } from "../../../core/types";
import {
  type MarkdownAugment,
  type SessionMessage,
  type SessionPagination,
  type SessionStateSnapshot,
  createEmptySessionSnapshot,
  getMessageId,
  mergeMessages,
  snapshotFromSessionDetail,
} from "../model";
import { useStreamingContent } from "../streaming/useStreamingContent";

interface StreamingMarkdownCallbacks {
  onAugment?: (augment: {
    blockIndex: number;
    html: string;
    type: string;
    messageId?: string;
  }) => void;
  onPending?: (pending: { html: string }) => void;
  onStreamEnd?: () => void;
  setCurrentMessageId?: (messageId: string | null) => void;
  captureHtml?: () => string | null;
}

interface UseSessionOptions {
  projectId: string;
  sessionId: string;
  initialOwnership?: SessionOwnership;
  streamingMarkdownCallbacks?: StreamingMarkdownCallbacks;
}

interface UseSessionResult {
  session: SessionStateSnapshot["session"];
  messages: SessionMessage[];
  ownership: SessionOwnership;
  pendingInputRequest: InputRequest | null;
  slashCommands: Array<{ name: string; description?: string }>;
  pagination: SessionPagination | null;
  markdownAugments: Record<string, MarkdownAugment>;
  liveStatus: string | null;
  permissionMode: PermissionMode | null;
  modeVersion: number | null;
  isCompacting: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error: string;
  connected: boolean;
  hasConnected: boolean;
  reconnectKey: number;
  reconcile: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  setPendingInputRequest: (
    value: InputRequest | null | ((current: InputRequest | null) => InputRequest | null),
  ) => void;
  setLiveStatus: (value: string | null | ((current: string | null) => string | null)) => void;
}

function mergeOlderMessages(
  current: SessionStateSnapshot,
  olderDetail: SessionDetail,
): SessionStateSnapshot {
  const olderSnapshot = snapshotFromSessionDetail(olderDetail);
  return {
    ...current,
    session: olderSnapshot.session,
    ownership: olderSnapshot.ownership,
    pendingInputRequest: olderSnapshot.pendingInputRequest,
    slashCommands: olderSnapshot.slashCommands,
    pagination: olderSnapshot.pagination,
    messages: [...olderSnapshot.messages, ...current.messages],
    markdownAugments: {
      ...olderSnapshot.markdownAugments,
      ...current.markdownAugments,
    },
  };
}

export function useSession({
  projectId,
  sessionId,
  initialOwnership,
  streamingMarkdownCallbacks,
}: UseSessionOptions): UseSessionResult {
  const [snapshot, setSnapshot] = useState<SessionStateSnapshot>(() => {
    const empty = createEmptySessionSnapshot();
    if (initialOwnership) return { ...empty, ownership: initialOwnership };
    return empty;
  });
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [isCompacting, setIsCompacting] = useState(false);
  const currentSessionIdRef = useRef(sessionId);

  const mergeIncomingMessage = useCallback((incomingMessage: SessionMessage) => {
    setSnapshot((current) => ({
      ...current,
      messages: mergeMessages(current.messages, [incomingMessage]),
    }));
  }, []);

  const { handleStreamEvent, clearStreaming, cleanup } = useStreamingContent({
    onUpdateMessage: mergeIncomingMessage,
    streamingMarkdownCallbacks,
  });

  const applyDetail = useCallback((detail: SessionDetail) => {
    setSnapshot(snapshotFromSessionDetail(detail));
  }, []);

  const reconcile = useCallback(async () => {
    const detail = await api.getSession(projectId, sessionId, { tailCompactions: 2 });
    applyDetail(detail);
  }, [applyDetail, projectId, sessionId]);

  const loadOlderMessages = useCallback(async () => {
    if (!snapshot.pagination?.truncatedBeforeMessageId) return;
    setLoadingOlder(true);
    try {
      const detail = await api.getSession(projectId, sessionId, {
        beforeMessageId: snapshot.pagination.truncatedBeforeMessageId,
        tailCompactions: 1,
      });
      setSnapshot((current) => mergeOlderMessages(current, detail));
    } finally {
      setLoadingOlder(false);
    }
  }, [projectId, sessionId, snapshot.pagination]);

  useEffect(() => {
    currentSessionIdRef.current = sessionId;
    setLoading(true);
    setError("");
    setHasConnected(false);
    setSnapshot(createEmptySessionSnapshot());
    clearStreaming();
    void reconcile()
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load session");
      })
      .finally(() => setLoading(false));
  }, [clearStreaming, reconcile, sessionId]);

  useEffect(() => cleanup, [cleanup]);

  const shouldConnect = useMemo(
    () => snapshot.ownership.owner === "self",
    [snapshot.ownership.owner],
  );

  useEffect(() => {
    if (!shouldConnect) {
      setConnected(false);
      return;
    }

    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    setConnected(false);

    const onConnected = (event: MessageEvent<string>) => {
      setConnected(true);
      setHasConnected(true);
      setError("");
      try {
        const data = JSON.parse(event.data) as {
          state?: string;
          request?: InputRequest;
          permissionMode?: PermissionMode;
          modeVersion?: number;
        };
        setSnapshot((current) => ({
          ...current,
          liveStatus: data.state ?? current.liveStatus,
          permissionMode: data.permissionMode ?? current.permissionMode,
          modeVersion: data.modeVersion ?? current.modeVersion,
          pendingInputRequest: data.request ?? current.pendingInputRequest,
        }));
      } catch {
        // Ignore malformed connected payloads.
      }
      void reconcile().catch(() => {});
    };

    const onMessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (handleStreamEvent(data)) return;

        const incoming = data as SessionMessage;
        const incomingId = getMessageId(incoming);

        // Track context compaction: system messages carry status:"compacting";
        // compact_boundary means compaction completed.
        if (incoming.type === "system") {
          const status = (incoming as { status?: string }).status;
          setIsCompacting(status === "compacting");
        }
        if (incoming.type === "compact_boundary") {
          setIsCompacting(false);
        }

        if ((incoming.type === "assistant" || incoming.type === "user") && incomingId) {
          clearStreaming();
          // Remove streaming placeholders atomically with the final message merge
          // to prevent duplicates (streaming placeholder uses Anthropic API ID,
          // final message uses server UUID — mergeMessages can't match them).
          setSnapshot((current) => ({
            ...current,
            messages: mergeMessages(
              current.messages.filter((m) => !m._isStreaming),
              [{ ...incoming, _source: "sdk", _isStreaming: false } as SessionMessage],
            ),
          }));
          return;
        }

        mergeIncomingMessage({
          ...incoming,
          _source: "sdk",
          _isStreaming: false,
        } as SessionMessage);
      } catch {
        // Ignore malformed stream payloads.
      }
    };

    const onStatus = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { state?: string; request?: InputRequest };
        setSnapshot((current) => ({
          ...current,
          liveStatus: data.state ?? current.liveStatus,
          pendingInputRequest:
            data.state === "waiting-input" ? (data.request ?? current.pendingInputRequest) : null,
        }));
      } catch {
        // Ignore malformed payloads.
      }
    };

    const onMarkdownAugment = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          blockIndex?: number;
          html: string;
          type?: string;
          messageId?: string;
        };
        if (typeof data.blockIndex === "number") {
          streamingMarkdownCallbacks?.onAugment?.({
            blockIndex: data.blockIndex,
            html: data.html,
            type: data.type ?? "text",
            messageId: data.messageId,
          });
          return;
        }
        if (data.messageId && data.html) {
          setSnapshot((current) => ({
            ...current,
            markdownAugments: {
              ...current.markdownAugments,
              [data.messageId as string]: { html: data.html },
            },
          }));
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    const onPending = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { html?: string };
        if (typeof data.html === "string") {
          streamingMarkdownCallbacks?.onPending?.({ html: data.html });
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    const onModeChange = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          permissionMode?: PermissionMode;
          modeVersion?: number;
        };
        setSnapshot((current) => ({
          ...current,
          permissionMode: data.permissionMode ?? current.permissionMode,
          modeVersion: data.modeVersion ?? current.modeVersion,
        }));
      } catch {
        // Ignore malformed payloads.
      }
    };

    const onComplete = () => {
      setConnected(false);
      // Clear the in-turn live status immediately so tools don't keep spinning
      // while reconcile() fetches the final session state asynchronously.
      setSnapshot((current) => ({ ...current, liveStatus: null }));
      streamingMarkdownCallbacks?.onStreamEnd?.();
      void reconcile().catch(() => {
        setReconnectKey((current) => current + 1);
      });
    };

    const onSessionIdChanged = () => {
      void reconcile().catch(() => {
        setReconnectKey((current) => current + 1);
      });
    };

    source.addEventListener("connected", onConnected as EventListener);
    source.addEventListener("message", onMessage as EventListener);
    source.addEventListener("status", onStatus as EventListener);
    source.addEventListener("mode-change", onModeChange as EventListener);
    source.addEventListener("markdown-augment", onMarkdownAugment as EventListener);
    source.addEventListener("pending", onPending as EventListener);
    source.addEventListener("complete", onComplete as EventListener);
    source.addEventListener("session-id-changed", onSessionIdChanged as EventListener);
    source.onerror = () => {
      setConnected(false);
      source.close();
    };

    return () => {
      setConnected(false);
      source.close();
    };
  }, [
    clearStreaming,
    handleStreamEvent,
    mergeIncomingMessage,
    reconcile,
    sessionId,
    shouldConnect,
    streamingMarkdownCallbacks,
  ]);

  return {
    session: snapshot.session,
    messages: snapshot.messages,
    ownership: snapshot.ownership,
    pendingInputRequest: snapshot.pendingInputRequest,
    slashCommands: snapshot.slashCommands,
    pagination: snapshot.pagination,
    markdownAugments: snapshot.markdownAugments,
    liveStatus: snapshot.liveStatus,
    permissionMode: snapshot.permissionMode,
    modeVersion: snapshot.modeVersion,
    isCompacting,
    loading,
    loadingOlder,
    error,
    connected,
    hasConnected,
    reconnectKey,
    reconcile,
    loadOlderMessages,
    setPendingInputRequest: (value) =>
      setSnapshot((current) => ({
        ...current,
        pendingInputRequest:
          typeof value === "function" ? value(current.pendingInputRequest) : value,
      })),
    setLiveStatus: (value) =>
      setSnapshot((current) => ({
        ...current,
        liveStatus: typeof value === "function" ? value(current.liveStatus) : value,
      })),
  };
}
