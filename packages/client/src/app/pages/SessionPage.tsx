import type { PermissionMode, SessionOwnership } from "@scholaraio-hub/shared";
import { Bell, Check, PenLine, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../../core/api";
import type { ModelInfo, ThinkingOption, UploadedFile } from "../../core/types";
import { api as sessionApi } from "../../features/session/api/client";
import { MessageInput } from "../../features/session/components/MessageInput";
import { MessageList } from "../../features/session/components/MessageList";
import { AgentContentProvider } from "../../features/session/contexts/AgentContentContext";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../../features/session/contexts/StreamingMarkdownContext";
import { useSession } from "../../features/session/hooks/useSession";
import type { Message as SessionRenderMessage } from "../../features/session/types";
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
    setSessionModel,
    messages,
    agentContent,
    setAgentContent,
    toolUseToAgent,
    status: ownership,
    processState,
    setStatus,
    setProcessState,
    pendingInputRequest,
    pagination,
    markdownAugments,
    loading,
    loadingOlder,
    error,
    connected,
    sessionUpdatesConnected,
    reconnectStream,
    loadOlderMessages,
    setPermissionMode,
    setHold,
    permissionMode,
    isHeld: sessionIsHeld,
    isCompacting,
    pendingMessages,
    addPendingMessage,
    removePendingMessage,
    updatePendingMessage,
    deferredMessages,
    slashCommands,
  } = useSession(
    projectId,
    sessionId,
    initialOwnership?.owner === "self" ? initialOwnership : undefined,
    streamingCallbacks,
  );

  useEffect(() => {
    if (permissionMode) setComposerPermissionMode(permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    setIsHeld(sessionIsHeld);
  }, [sessionIsHeld]);

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
    setSessionModel(model);
    if (ownership.owner === "self") {
      await api.changeModel(ownership.processId, model).catch(() => {});
    }
  };

  const handlePermissionModeChange = async (mode: PermissionMode) => {
    setComposerPermissionMode(mode);
    await setPermissionMode(mode).catch(() => {});
  };

  const handleHoldChange = async (held: boolean) => {
    setIsHeld(held);
    await setHold(held).catch(() => {});
  };

  const handleStop = () => {
    if (ownership.owner !== "self") return;
    void api
      .abortProcess(ownership.processId)
      .then(() => {
        setStatus({ owner: "none" });
        setProcessState("idle");
      })
      .catch(() => {});
  };

  const send = async () => {
    if (!session || (!message.trim() && files.length === 0)) return;
    const trimmed = message.trim();
    const tempId = addPendingMessage(trimmed);

    setBusy(true);
    setSendError("");
    setMessage("");
    setFiles([]);
    setScrollTrigger((n) => n + 1);
    setProcessState("in-turn");

    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        updatePendingMessage(tempId, { status: "Uploading…" });
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, sessionId, file)),
        );
        updatePendingMessage(tempId, { status: undefined });
      }

      if (ownership.owner === "self") {
        const result = await sessionApi.queueMessage(
          sessionId,
          trimmed,
          composerPermissionMode,
          attachments,
          tempId,
          thinking,
        );
        if (result.restarted && result.processId) {
          setStatus({ owner: "self", processId: result.processId });
          reconnectStream();
        }
      } else {
        const result = await sessionApi.resumeSession(
          projectId,
          sessionId,
          trimmed,
          {
            mode: composerPermissionMode,
            thinking,
            model: session.model ?? selectedModel,
            provider: session.provider,
            executor: session.executor,
          },
          attachments,
          tempId,
        );
        setStatus({ owner: "self", processId: result.processId });
      }
    } catch (err) {
      removePendingMessage(tempId);
      setMessage(trimmed);
      setSendError(err instanceof Error ? err.message : "Failed to send message");
      setProcessState("idle");
    } finally {
      setBusy(false);
    }
  };

  const queue = async () => {
    if (ownership.owner !== "self") {
      await send();
      return;
    }
    if (!message.trim() && files.length === 0) return;
    const trimmed = message.trim();
    const tempId = addPendingMessage(trimmed);
    setBusy(true);
    setSendError("");
    setMessage("");
    setFiles([]);
    setScrollTrigger((n) => n + 1);
    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        updatePendingMessage(tempId, { status: "Uploading…" });
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, sessionId, file)),
        );
        updatePendingMessage(tempId, { status: undefined });
      }
      await sessionApi.queueMessage(
        sessionId,
        trimmed,
        composerPermissionMode,
        attachments,
        tempId,
        thinking,
        true,
      );
      removePendingMessage(tempId);
    } catch (err) {
      removePendingMessage(tempId);
      setMessage(trimmed);
      setSendError(err instanceof Error ? err.message : "Failed to queue message");
    } finally {
      setBusy(false);
    }
  };

  const respondToPendingInput = async (response: "approve" | "approve_accept_edits" | "deny") => {
    if (!pendingInputRequest) return;
    await api.respondToInput(sessionId, pendingInputRequest.id, response);
    setProcessState("in-turn");
  };

  // Use initialTitle from navigation state as an optimistic title until session data loads.
  const title = session?.customTitle ?? session?.title ?? initialTitle ?? sessionId;
  const processStateLabel =
    processState === "in-turn"
      ? "running"
      : processState === "waiting-input"
        ? "needs input"
        : processState === "hold"
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
      : processState === "in-turn" || processState === "hold"
        ? "Queue a follow-up message"
        : "Continue this session";

  // Treat tools as still-pending (not orphaned) when the session is actively running,
  // waiting for approval, or the SSE connection hasn't been established yet for the
  // first time. Once SSE has connected and completed, orphaned tools show as aborted.
  const activeToolApproval =
    processState === "in-turn" ||
    processState === "waiting-input" ||
    (ownership.owner === "self" && !sessionUpdatesConnected);

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

        {error ? <div className="error">{error.message}</div> : null}
        {sendError ? <div className="error">{sendError}</div> : null}
        {loading ? <div className="loading">Loading session...</div> : null}

        {!loading ? (
          <AgentContentProvider
            agentContent={agentContent}
            setAgentContent={setAgentContent}
            toolUseToAgent={toolUseToAgent}
            projectId={projectId}
            sessionId={sessionId}
          >
            <MessageList
              messages={messages as SessionRenderMessage[]}
              markdownAugments={markdownAugments}
              provider={session?.provider}
              isStreaming={ownership.owner === "self" && processState === "in-turn"}
              isProcessing={ownership.owner === "self" && processState === "in-turn"}
              isCompacting={isCompacting}
              scrollTrigger={scrollTrigger}
              activeToolApproval={activeToolApproval}
              hasOlderMessages={pagination?.hasOlderMessages ?? false}
              loadingOlder={loadingOlder}
              onLoadOlderMessages={loadOlderMessages}
              pendingMessages={pendingMessages}
              deferredMessages={deferredMessages}
              onCancelDeferred={(tempId) => {
                void sessionApi.cancelDeferredMessage(sessionId, tempId);
              }}
            />
          </AgentContentProvider>
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
            slashCommands={
              ownership.owner === "self" ? slashCommands.map((name) => ({ name })) : []
            }
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
            onQueue={ownership.owner === "self" && processState !== "idle" ? queue : undefined}
            onStop={handleStop}
            isRunning={ownership.owner === "self"}
            isThinking={processState === "in-turn" || processState === "hold"}
            placeholder={placeholder}
          />
        </div>
      </footer>
    </section>
  );
}
