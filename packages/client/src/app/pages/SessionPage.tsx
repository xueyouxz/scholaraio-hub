import type { PermissionMode, SessionOwnership } from "@scholaraio-hub/shared";
import { Bell, Check, PenLine, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../../core/api";
import type { ModelInfo, ThinkingOption, UploadedFile } from "../../core/types";
import { MessageInput } from "../../features/session/components/MessageInput";
import { MessageList } from "../../features/session/components/MessageList";
import { useSession } from "../../features/session/hooks/useSession";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../../features/session/streaming/StreamingMarkdownContext";
import { SessionMetadataProvider } from "../../shared/contexts/SessionMetadataContext";
import { usePageTitle } from "../components/NavigationLayout";

export function SessionPage() {
  const { projectId = "", sessionId = "" } = useParams();
  const location = useLocation();
  const navState = location.state as {
    initialOwnership?: SessionOwnership;
    initialTitle?: string;
  } | null;

  if (!projectId || !sessionId) {
    return (
      <div className="panel session-workspace">
        <div className="panel-body">
          <div className="empty">Invalid session route.</div>
        </div>
      </div>
    );
  }

  return (
    <SessionMetadataProvider projectId={projectId} projectPath={null} sessionId={sessionId}>
      <StreamingMarkdownProvider>
        {/* key={sessionId} forces full remount on session change, resetting all streaming state */}
        <SessionPageContent
          key={sessionId}
          projectId={projectId}
          sessionId={sessionId}
          initialOwnership={navState?.initialOwnership}
          initialTitle={navState?.initialTitle}
        />
      </StreamingMarkdownProvider>
    </SessionMetadataProvider>
  );
}

function SessionPageContent({
  projectId,
  sessionId,
  initialOwnership,
  initialTitle,
}: {
  projectId: string;
  sessionId: string;
  initialOwnership?: SessionOwnership;
  initialTitle?: string;
}) {
  const { setTitle } = usePageTitle();
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [composerPermissionMode, setComposerPermissionMode] = useState<PermissionMode>("default");
  const [isHeld, setIsHeld] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [pendingMessages, setPendingMessages] = useState<
    Array<{ tempId: string; content: string; status?: string }>
  >([]);
  const streamingContext = useStreamingMarkdownContext();

  const streamingCallbacks = useMemo(() => {
    if (!streamingContext) return undefined;
    return {
      onAugment: streamingContext.dispatchAugment,
      onPending: streamingContext.dispatchPending,
      onStreamEnd: streamingContext.dispatchStreamEnd,
      setCurrentMessageId: streamingContext.setCurrentMessageId,
      captureHtml: streamingContext.captureStreamingHtml,
    };
  }, [streamingContext]);

  const {
    session,
    messages,
    ownership,
    pendingInputRequest,
    pagination,
    markdownAugments,
    loading,
    loadingOlder,
    error,
    connected,
    reconcile,
    loadOlderMessages,
    setPendingInputRequest,
    permissionMode,
    liveStatus,
    isCompacting,
    slashCommands,
  } = useSession({
    projectId,
    sessionId,
    initialOwnership,
    streamingMarkdownCallbacks: streamingCallbacks,
  });

  useEffect(() => {
    if (permissionMode) setComposerPermissionMode(permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    if (!liveStatus) return;
    setIsHeld(liveStatus === "hold");
  }, [liveStatus]);

  // Load models for the session's provider
  useEffect(() => {
    if (!session?.provider) return;
    api.getProviders().then((data) => {
      const provider = data.providers.find((p) => p.name === session.provider);
      if (provider?.models && provider.models.length > 0) {
        setModels(provider.models);
        setSelectedModel((prev) => prev ?? session.model ?? provider.models?.[0]?.id);
      }
    });
  }, [session?.provider, session?.model]);

  const handleModelChange = async (model: string) => {
    setSelectedModel(model);
    if (ownership.owner === "self") {
      await api.changeModel(ownership.processId, model).catch(() => {});
    }
  };

  const handlePermissionModeChange = async (mode: PermissionMode) => {
    setComposerPermissionMode(mode);
    if (ownership.owner !== "self") return;
    await api.setPermissionMode(sessionId, mode).catch(() => {});
  };

  const handleHoldChange = async (held: boolean) => {
    setIsHeld(held);
    if (ownership.owner !== "self") return;
    const result = await api.setHold(sessionId, held).catch(() => null);
    if (result) setIsHeld(result.isHeld);
  };

  const handleStop = () => {
    if (ownership.owner !== "self") return;
    void api
      .abortProcess(ownership.processId)
      .then(() => reconcile())
      .catch(() => {});
  };

  const send = async () => {
    if (!session || (!message.trim() && files.length === 0)) return;
    const trimmed = message.trim();
    const tempId = `pending-${Date.now()}`;

    setBusy(true);
    setSendError("");
    setMessage("");
    setFiles([]);
    setScrollTrigger((n) => n + 1);
    if (trimmed) setPendingMessages((prev) => [...prev, { tempId, content: trimmed }]);

    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        if (trimmed)
          setPendingMessages((prev) =>
            prev.map((m) => (m.tempId === tempId ? { ...m, status: "Uploading…" } : m)),
          );
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, sessionId, file)),
        );
      }

      if (ownership.owner === "self") {
        await api.queueMessage({
          sessionId,
          message: trimmed,
          mode: composerPermissionMode,
          thinking,
          attachments,
        });
      } else {
        await api.resumeSession({
          projectId,
          sessionId,
          message: trimmed,
          mode: composerPermissionMode,
          thinking,
          attachments,
        });
      }

      setPendingMessages((prev) => prev.filter((m) => m.tempId !== tempId));
      await reconcile();
    } catch (err) {
      setPendingMessages((prev) => prev.filter((m) => m.tempId !== tempId));
      setMessage(trimmed);
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const queue = async () => {
    if (ownership.owner !== "self") {
      await send();
      return;
    }
    await send();
  };

  const respondToPendingInput = async (response: "approve" | "approve_accept_edits" | "deny") => {
    if (!pendingInputRequest) return;
    await api.respondToInput(sessionId, pendingInputRequest.id, response);
    setPendingInputRequest(null);
    await reconcile();
  };

  // Use initialTitle from navigation state as an optimistic title until session data loads.
  const title = session?.customTitle ?? session?.title ?? initialTitle ?? sessionId;
  const processStateLabel =
    liveStatus === "in-turn"
      ? "running"
      : liveStatus === "waiting-input"
        ? "needs input"
        : liveStatus === "hold"
          ? "held"
          : ownership.owner === "external"
            ? "external"
            : "idle";

  const statePillClass =
    processStateLabel === "idle"
      ? "bg-surface-container text-on-surface-variant"
      : processStateLabel === "external"
        ? "bg-tertiary-container/20 text-tertiary"
        : "bg-tertiary-container/30 text-tertiary";
  const connectionStatus =
    ownership.owner === "self" ? (connected ? "connected" : "connecting") : "idle";
  const placeholder =
    ownership.owner === "external"
      ? "This session is running elsewhere"
      : liveStatus === "in-turn" || liveStatus === "hold"
        ? "Queue a follow-up message"
        : "Continue this session";

  // Treat tools as still-pending (not orphaned) when the session is actively running,
  // waiting for approval, or the SSE connection hasn't been established yet.
  const activeToolApproval =
    liveStatus === "in-turn" ||
    liveStatus === "waiting-input" ||
    (ownership.owner === "self" && !connected);

  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);

  return (
    <section className="session-page">
      {/* Session header */}
      <header className="shrink-0 flex items-center justify-between h-[3.25rem] px-4 border-b border-outline-variant/10 bg-surface z-10">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-sans text-sm font-medium text-on-surface truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {session?.provider ? (
            <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
              {session.provider}
              {session.model ? ` · ${session.model}` : ""}
            </span>
          ) : null}
          <span
            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${statePillClass}`}
          >
            {processStateLabel}
          </span>
        </div>
      </header>

      {ownership.owner === "external" ? (
        <div className="mx-auto w-full max-w-[830px] mt-2 px-4 py-2 rounded-lg bg-tertiary-container/20 border border-tertiary/20 text-tertiary text-xs">
          This session is controlled elsewhere.
        </div>
      ) : null}

      <main className="session-messages">
        {pendingInputRequest ? (
          <div className="max-w-[830px] mx-auto mb-3 bg-surface-container-low border border-outline-variant/15 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-on-surface-variant shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium text-on-surface">
                {pendingInputRequest.toolName ?? pendingInputRequest.prompt}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void respondToPendingInput("approve")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity"
              >
                <Check size={13} aria-hidden="true" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => void respondToPendingInput("approve_accept_edits")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <PenLine size={13} aria-hidden="true" />
                Approve + Accept Edits
              </button>
              <button
                type="button"
                onClick={() => void respondToPendingInput("deny")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-error hover:bg-error-container/20 transition-colors"
              >
                <X size={13} aria-hidden="true" />
                Deny
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="error">{error}</div> : null}
        {sendError ? <div className="error">{sendError}</div> : null}
        {loading ? <div className="loading">Loading session...</div> : null}

        {!loading ? (
          <MessageList
            messages={messages}
            markdownAugments={markdownAugments}
            pagination={pagination}
            loadingOlder={loadingOlder}
            onLoadOlderMessages={loadOlderMessages}
            sessionProvider={session?.provider}
            isProcessing={ownership.owner === "self" && liveStatus === "in-turn"}
            isCompacting={isCompacting}
            scrollTrigger={scrollTrigger}
            activeToolApproval={activeToolApproval}
            pendingMessages={pendingMessages}
          />
        ) : null}
      </main>

      <footer className="session-input">
        <div className={`session-connection-bar session-connection-${connectionStatus}`} />
        <div className="session-input-inner">
          <MessageInput
            message={message}
            thinking={thinking}
            busy={busy}
            files={files}
            model={selectedModel}
            models={models}
            permissionMode={composerPermissionMode}
            isHeld={isHeld}
            draftKey={`session:${sessionId}`}
            slashCommands={ownership.owner === "self" ? slashCommands : []}
            contextUsage={session?.contextUsage}
            onMessageChange={setMessage}
            onThinkingChange={setThinking}
            onFilesChange={setFiles}
            onModelChange={(m) => void handleModelChange(m)}
            onPermissionModeChange={(mode) => void handlePermissionModeChange(mode)}
            onHoldChange={
              ownership.owner === "self" ? (held) => void handleHoldChange(held) : undefined
            }
            onSend={send}
            onQueue={ownership.owner === "self" && liveStatus !== "idle" ? queue : undefined}
            onStop={handleStop}
            isRunning={ownership.owner === "self"}
            isThinking={liveStatus === "in-turn" || liveStatus === "hold"}
            placeholder={placeholder}
          />
        </div>
      </footer>
    </section>
  );
}
