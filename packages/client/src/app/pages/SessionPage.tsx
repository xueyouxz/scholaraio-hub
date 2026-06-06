import { type PermissionMode, toUrlProjectId } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, Check, FolderTree, PenLine, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { ThinkingOption } from "../../core/types";
import { PaperReaderView } from "../../features/library/reader/PaperReaderView";
import { MessageInput } from "../../features/session/components/MessageInput";
import { MessageList, type MessageListHandle } from "../../features/session/components/MessageList";
import { ResizableProjectFilesPanel } from "../../features/session/components/ProjectFilesPanel";
import { ResizableWorkspacePapersPanel } from "../../features/session/components/WorkspacePapersPanel";
import { AgentContentProvider } from "../../features/session/contexts/AgentContentContext";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../../features/session/contexts/StreamingMarkdownContext";
import { useAttachmentUploads } from "../../features/session/hooks/useAttachmentUploads";
import { useEngagementTracking } from "../../features/session/hooks/useEngagementTracking";
import { useSession } from "../../features/session/hooks/useSession";
import type {
  SessionNavState,
  Message as SessionRenderMessage,
} from "../../features/session/types";
import { SessionMetadataProvider } from "../../shared/contexts/SessionMetadataContext";
import { usePageTitle } from "../components/NavigationLayout";

export function SessionPage() {
  const { projectId = "", sessionId = "" } = useParams();
  const location = useLocation();
  const navState = location.state as SessionNavState | null;

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
          initialStatus={navState?.initialStatus}
          initialTitle={navState?.initialTitle}
        />
      </StreamingMarkdownProvider>
    </SessionMetadataProvider>
  );
}

function SessionPageContent({
  projectId,
  sessionId,
  initialStatus,
  initialTitle,
}: {
  projectId: string;
  sessionId: string;
  initialStatus?: { owner: "self"; processId: string };
  initialTitle?: string;
}) {
  const navigate = useNavigate();
  const { setTitle } = usePageTitle();
  const [rightPanel, setRightPanel] = useState<"files" | "papers" | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const messageListRef = useRef<MessageListHandle>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingContext = useStreamingMarkdownContext();

  const streamingCallbacks = useMemo(() => {
    if (!streamingContext) return undefined;
    return {
      onAugment: streamingContext.dispatchAugment,
      onPending: streamingContext.dispatchPending,
      onStreamEnd: streamingContext.dispatchStreamEnd,
    };
  }, [streamingContext]);

  const {
    session,
    setSessionModel,
    messages,
    agentContent,
    mergeAgentContent,
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
    refreshRuntimeState,
    actualSessionId,
  } = useSession(projectId, sessionId, initialStatus, streamingCallbacks);

  // When the server assigns the real session ID (temp→real transition), replace
  // the URL so the address bar, browser history, and stream endpoint all stay
  // in sync without adding a spurious history entry.
  useEffect(() => {
    if (actualSessionId !== sessionId) {
      navigate(`/projects/${projectId}/sessions/${actualSessionId}`, { replace: true });
    }
  }, [actualSessionId, sessionId, projectId, navigate]);

  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers,
    staleTime: 5 * 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.getProjects({ signal }),
    select: (data) => data.projects,
    staleTime: 5 * 60_000,
  });
  const workspacesQuery = useQuery({
    queryKey: queryKeys.scholar.workspaces(),
    queryFn: ({ signal }) => scholar.getWorkspaces({ signal }),
    select: (data) => data.workspaces,
    staleTime: 5 * 60_000,
  });
  const currentProject = useMemo(
    () => projectsQuery.data?.find((p) => p.id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  // Resolve workspace for this session by reverse-matching the URL projectId
  // against each workspace's toUrlProjectId(path). This avoids depending on
  // projectsQuery — which is cached for 5 min and may not yet contain a project
  // that was just created by sending the first message on NewSessionPage.
  const workspaceName = useMemo(() => {
    const workspaces = workspacesQuery.data ?? [];
    const match =
      workspaces.find((w) => toUrlProjectId(w.path) === projectId) ??
      (currentProject
        ? (workspaces.find((w) => w.path === currentProject.path) ??
          workspaces.find((w) => w.name === (currentProject.name ?? "")))
        : undefined);
    return match?.name ?? null;
  }, [projectId, currentProject, workspacesQuery.data]);
  const projectRootName = useMemo(() => {
    if (currentProject?.name) return currentProject.name;
    const path = currentProject?.path;
    if (path) {
      const trimmed = path.replace(/[\\/]+$/, "");
      const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
      if (base) return base;
    }
    return null;
  }, [currentProject]);

  const handleTogglePapers = () => {
    setRightPanel((prev) => (prev === "papers" ? null : "papers"));
    if (rightPanel === "papers") {
      setSelectedPaperId(null);
    }
  };
  const handleToggleFiles = () => {
    setRightPanel((prev) => (prev === "files" ? null : "files"));
    setSelectedPaperId(null);
  };
  const closeRightPanel = () => {
    setRightPanel(null);
    setSelectedPaperId(null);
  };
  const provider = useMemo(
    () => providersQuery.data?.find((p) => p.name === session?.provider),
    [providersQuery.data, session?.provider],
  );
  const models = provider?.models ?? [];
  const supportsPermissionMode = provider?.supportsPermissionMode ?? true;
  const supportsThinkingToggle = provider?.supportsThinkingToggle ?? true;

  useEffect(() => {
    if (models.length === 0) return;
    setSelectedModel((prev) => prev ?? session?.model ?? models[0]?.id);
  }, [models, session?.model]);

  const attachmentUploads = useAttachmentUploads({
    projectId,
    sessionId,
    onUploadError: (failure) => {
      setSendError(`${failure.fileName}: ${failure.message}`);
    },
  });

  const handleModelChange = async (model: string) => {
    const previousSelected = selectedModel;
    const previousSessionModel = session?.model;
    setSelectedModel(model);
    setSessionModel(model);
    if (ownership.owner !== "self") return;
    try {
      await api.changeModel(ownership.processId, model);
    } catch (err) {
      // Roll back optimistic UI on server failure so the switcher reflects reality.
      setSelectedModel(previousSelected);
      if (previousSessionModel) setSessionModel(previousSessionModel);
      throw err;
    }
  };

  const handlePermissionModeChange = async (mode: PermissionMode) => {
    await setPermissionMode(mode).catch(() => {});
  };

  const handleHoldChange = async (held: boolean) => {
    await setHold(held).catch(() => {});
  };

  // Cleanup stop timeout on unmount so it never fires against a dead component.
  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    };
  }, []);

  const handleStop = async () => {
    if (ownership.owner !== "self") return;
    // Cancel any pending stop timeout from a previous attempt.
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    try {
      await api.interruptProcess(ownership.processId);
      // Fallback: if the SSE "complete" event never arrives (e.g. stream is
      // briefly disconnected), reconcile ownership from the server after 3 s.
      stopTimeoutRef.current = setTimeout(async () => {
        stopTimeoutRef.current = null;
        await refreshRuntimeState().catch(() => {});
      }, 3000);
    } catch {
      await api.abortProcess(ownership.processId).catch((e) => {
        console.warn("[SessionPage] abortProcess failed after interruptProcess error", e);
      });
      await refreshRuntimeState().catch(() => {});
    }
  };

  const send = async (finalMessage: string) => {
    if (!session || (!finalMessage.trim() && !attachmentUploads.hasAttachments)) return;
    const trimmed = finalMessage.trim();
    const tempId = addPendingMessage(trimmed);
    const attachmentSnapshot = attachmentUploads.snapshot();

    setBusy(true);
    setSendError("");
    setMessage("");
    messageListRef.current?.scrollToBottom();
    setProcessState("in-turn");

    try {
      const hadPendingUploads = attachmentUploads.hasPendingUploads;
      if (hadPendingUploads) {
        updatePendingMessage(tempId, { status: "Uploading…" });
      }
      const attachments = await attachmentUploads.waitForUploads();
      attachmentUploads.clearAttachments();
      if (hadPendingUploads) {
        updatePendingMessage(tempId, { status: undefined });
      }

      if (ownership.owner === "self") {
        const result = await api.queueMessage({
          sessionId,
          message: trimmed,
          mode: permissionMode ?? "default",
          attachments,
          thinking,
          tempId,
        });
        if (result.restarted && result.processId) {
          setStatus({ owner: "self", processId: result.processId });
          reconnectStream();
        }
      } else {
        const result = await api.resumeSession({
          projectId,
          sessionId,
          message: trimmed,
          mode: permissionMode ?? "default",
          thinking,
          model: session.model ?? selectedModel,
          provider: session.provider,
          attachments,
          tempId,
        });
        setStatus({ owner: "self", processId: result.processId });
      }
    } catch (err) {
      removePendingMessage(tempId);
      setMessage(trimmed);
      attachmentUploads.restoreSnapshot(attachmentSnapshot);
      setSendError(err instanceof Error ? err.message : "Failed to send message");
      setProcessState("idle");
    } finally {
      setBusy(false);
    }
  };

  const queue = async (finalMessage: string) => {
    if (ownership.owner !== "self") {
      await send(finalMessage);
      return;
    }
    if (!finalMessage.trim() && !attachmentUploads.hasAttachments) return;
    const trimmed = finalMessage.trim();
    const tempId = addPendingMessage(trimmed);
    const attachmentSnapshot = attachmentUploads.snapshot();
    setBusy(true);
    setSendError("");
    setMessage("");
    messageListRef.current?.scrollToBottom();
    try {
      const hadPendingUploads = attachmentUploads.hasPendingUploads;
      if (hadPendingUploads) {
        updatePendingMessage(tempId, { status: "Uploading…" });
      }
      const attachments = await attachmentUploads.waitForUploads();
      attachmentUploads.clearAttachments();
      if (hadPendingUploads) {
        updatePendingMessage(tempId, { status: undefined });
      }
      await api.queueMessage({
        sessionId,
        message: trimmed,
        mode: permissionMode ?? "default",
        attachments,
        thinking,
        tempId,
        deferred: true,
      });
      removePendingMessage(tempId);
    } catch (err) {
      removePendingMessage(tempId);
      setMessage(trimmed);
      attachmentUploads.restoreSnapshot(attachmentSnapshot);
      setSendError(err instanceof Error ? err.message : "Failed to queue message");
    } finally {
      setBusy(false);
    }
  };

  const respondToPendingInput = async (response: "approve" | "approve_accept_edits" | "deny") => {
    if (!pendingInputRequest) return;
    await api.respondToInput(sessionId, pendingInputRequest.id, response);
    if (response === "deny") {
      window.setTimeout(() => {
        void refreshRuntimeState().catch(() => {});
      }, 250);
      return;
    }
    await refreshRuntimeState().catch(() => {});
  };

  // Use initialTitle from navigation state as an optimistic title until session data loads.
  const title = session?.customTitle ?? session?.title ?? initialTitle ?? sessionId;
  const processStateLabel =
    ownership.owner === "external"
      ? "external"
      : ownership.owner !== "self"
        ? "idle"
        : processState === "in-turn"
          ? "running"
          : processState === "waiting-input"
            ? "needs input"
            : processState === "hold"
              ? "held"
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

  useEngagementTracking(sessionId);

  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <section className="session-page flex-1 min-w-0">
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
            <button
              type="button"
              onClick={handleToggleFiles}
              title="Project files"
              className={`p-1 rounded transition-colors ${rightPanel === "files" ? "text-primary bg-primary/10" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"}`}
            >
              <FolderTree size={15} />
            </button>
            {workspaceName ? (
              <button
                type="button"
                onClick={handleTogglePapers}
                title="Workspace papers"
                className={`p-1 rounded transition-colors ${rightPanel === "papers" ? "text-primary bg-primary/10" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"}`}
              >
                <BookOpen size={15} />
              </button>
            ) : null}
          </div>
        </header>

        {ownership.owner === "external" ? (
          <div className="mx-auto w-full max-w-[830px] mt-2 px-4 py-2 rounded-lg bg-tertiary-container/20 border border-tertiary/20 text-tertiary text-xs">
            This session is controlled elsewhere.
          </div>
        ) : null}

        {ownership.owner !== "self" && pendingInputRequest ? (
          <div className="mx-auto w-full max-w-[830px] mt-2 px-4 py-2 rounded-lg bg-warning-container/20 text-warning text-xs">
            This session is waiting for tool call approval. Become the owner to respond.
          </div>
        ) : null}

        {pendingInputRequest ? (
          <div className="tool-approval-fixed" role="presentation">
            <div className="tool-approval-panel" role="alert" aria-live="assertive">
              <div className="tool-approval-header">
                <Bell className="tool-approval-icon" aria-hidden="true" />
                <span className="tool-approval-question">
                  {pendingInputRequest.toolName ?? pendingInputRequest.prompt}
                </span>
              </div>
              <div className="tool-approval-options">
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("approve")}
                  className="tool-approval-option primary"
                >
                  <Check size={13} aria-hidden="true" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("approve_accept_edits")}
                  className="tool-approval-option"
                >
                  <PenLine size={13} aria-hidden="true" />
                  Approve + Accept Edits
                </button>
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("deny")}
                  className="tool-approval-option danger"
                >
                  <X size={13} aria-hidden="true" />
                  Deny
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {selectedPaperId ? (
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PaperReaderView paperId={selectedPaperId} onClose={() => setSelectedPaperId(null)} />
          </main>
        ) : (
          <main
            className={`session-messages${pendingInputRequest ? " session-messages-with-approval" : ""}`}
          >
            {error ? <div className="error">{error.message}</div> : null}
            {sendError ? <div className="error">{sendError}</div> : null}
            {loading ? <div className="loading">Loading session...</div> : null}

            {!loading ? (
              <AgentContentProvider
                agentContent={agentContent}
                mergeAgentContent={mergeAgentContent}
                toolUseToAgent={toolUseToAgent}
                projectId={projectId}
                sessionId={sessionId}
              >
                <MessageList
                  ref={messageListRef}
                  messages={messages as SessionRenderMessage[]}
                  markdownAugments={markdownAugments}
                  provider={session?.provider}
                  isStreaming={ownership.owner === "self" && processState === "in-turn"}
                  isProcessing={ownership.owner === "self" && processState === "in-turn"}
                  isCompacting={isCompacting}
                  activeToolApproval={activeToolApproval}
                  hasOlderMessages={pagination?.hasOlderMessages ?? false}
                  loadingOlder={loadingOlder}
                  onLoadOlderMessages={loadOlderMessages}
                  pendingMessages={pendingMessages}
                  deferredMessages={deferredMessages}
                  onCancelDeferred={(tempId) => {
                    void api.cancelDeferredMessage(sessionId, tempId);
                  }}
                />
              </AgentContentProvider>
            ) : null}
          </main>
        )}

        {selectedPaperId ? null : (
          <footer className="session-input">
            <div className={`session-connection-bar session-connection-${connectionStatus}`} />
            <div className="session-input-inner">
              <MessageInput
                message={message}
                thinking={thinking}
                busy={busy}
                attachments={attachmentUploads.attachments}
                uploadProgress={attachmentUploads.uploadProgress}
                model={selectedModel}
                models={models}
                permissionMode={permissionMode ?? "default"}
                isHeld={sessionIsHeld}
                draftKey={`session:${sessionId}`}
                slashCommands={slashCommands}
                contextUsage={session?.contextUsage}
                onMessageChange={setMessage}
                onThinkingChange={setThinking}
                onAttachFiles={attachmentUploads.addFiles}
                onRemoveAttachment={attachmentUploads.removeAttachment}
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
                supportsPermissionMode={supportsPermissionMode}
                supportsThinkingToggle={supportsThinkingToggle}
              />
            </div>
          </footer>
        )}
      </section>
      <ResizableProjectFilesPanel
        open={rightPanel === "files"}
        projectId={projectId}
        rootName={projectRootName}
        onClose={closeRightPanel}
      />
      {workspaceName ? (
        <ResizableWorkspacePapersPanel
          open={rightPanel === "papers"}
          workspaceName={workspaceName}
          selectedPaperId={selectedPaperId}
          onSelectPaper={setSelectedPaperId}
          onClose={closeRightPanel}
        />
      ) : null}
    </div>
  );
}
