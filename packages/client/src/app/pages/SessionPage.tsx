import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, providerLabel } from "../../core/api";
import type { ProcessSummary, ThinkingOption, UploadedFile } from "../../core/types";
import { MessageComposer } from "../session/components/MessageComposer";
import { MessageList } from "../session/components/MessageList";
import { SessionHeader } from "../session/components/SessionHeader";
import { getMessageId } from "../session/model";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../session/streaming/StreamingMarkdownContext";
import { useSessionPageState } from "../session/useSessionPageState";

export function SessionPage() {
  const { projectId = "", sessionId = "" } = useParams();

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
    <StreamingMarkdownProvider>
      <SessionPageContent projectId={projectId} sessionId={sessionId} />
    </StreamingMarkdownProvider>
  );
}

function SessionPageContent({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState<ThinkingOption>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
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
    liveStatus,
    loading,
    loadingOlder,
    error,
    connected,
    reconcile,
    loadOlderMessages,
    setPendingInputRequest,
  } = useSessionPageState({
    projectId,
    sessionId,
    streamingMarkdownCallbacks: streamingCallbacks,
  });

  const processSummary = useMemo<ProcessSummary | null>(() => {
    if (ownership.owner !== "self") return null;
    return {
      id: ownership.processId,
      sessionId,
      projectId,
      provider: session?.provider ?? "claude",
      state: liveStatus ?? "running",
      model: session?.model ?? null,
      permissionMode: ownership.permissionMode,
    };
  }, [liveStatus, ownership, projectId, session?.model, session?.provider, sessionId]);

  const send = async () => {
    if (!session || (!message.trim() && files.length === 0)) return;
    setBusy(true);
    setSendError("");
    try {
      let attachments: UploadedFile[] = [];
      if (files.length > 0) {
        attachments = await Promise.all(
          files.map((file) => api.uploadAttachment(projectId, sessionId, file)),
        );
      }

      if (ownership.owner === "self") {
        await api.queueMessage({
          sessionId,
          message: message.trim(),
          thinking,
          attachments,
        });
      } else {
        await api.resumeSession({
          projectId,
          sessionId,
          message: message.trim(),
          thinking,
          attachments,
        });
      }

      setMessage("");
      setFiles([]);
      await reconcile();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const respondToPendingInput = async (response: "approve" | "approve_accept_edits" | "deny") => {
    if (!pendingInputRequest) return;
    await api.respondToInput(sessionId, pendingInputRequest.id, response);
    setPendingInputRequest(null);
    await reconcile();
  };

  const interrupt = async () => {
    if (!processSummary) return;
    await api.interruptProcess(processSummary.id);
    await reconcile();
  };

  const abort = async () => {
    if (!processSummary) return;
    await api.abortProcess(processSummary.id);
    await reconcile();
  };

  const title = session?.customTitle ?? session?.title ?? sessionId;

  return (
    <section className="session-workspace">
      <SessionHeader
        projectId={projectId}
        title={title}
        providerLabel={providerLabel(session?.provider)}
        modelLabel={session?.model ?? "default model"}
        ownershipLabel={ownership.owner}
        liveStatus={liveStatus}
        connected={connected}
      />

      {pendingInputRequest ? (
        <div className="session-alert">
          <div>
            <strong>Pending Input</strong>
            <p>{pendingInputRequest.toolName ?? pendingInputRequest.prompt}</p>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => void respondToPendingInput("approve")}>
              Approve
            </button>
            <button
              type="button"
              onClick={() => void respondToPendingInput("approve_accept_edits")}
            >
              Approve + Accept Edits
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void respondToPendingInput("deny")}
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="empty">{error}</div> : null}
      {sendError ? <div className="empty">{sendError}</div> : null}
      {loading ? <div className="empty">Loading session…</div> : null}

      <div className="session-workspace-body">
        <MessageList
          messages={messages}
          markdownAugments={markdownAugments}
          pagination={pagination}
          loadingOlder={loadingOlder}
          onLoadOlderMessages={loadOlderMessages}
        />
        <aside className="session-sidepanel">
          <div className="session-sidecard">
            <p className="eyebrow">Session Meta</p>
            <div className="stack">
              <span className="badge">{providerLabel(session?.provider)}</span>
              <span className="badge">{session?.model ?? "default model"}</span>
              <span className="badge">{ownership.owner}</span>
              {liveStatus ? <span className="badge waiting">{liveStatus}</span> : null}
              <span className="muted">
                {session
                  ? `${messages.filter((entry) => Boolean(getMessageId(entry))).length} messages loaded`
                  : "No metadata yet"}
              </span>
            </div>
          </div>
          {processSummary ? (
            <div className="session-sidecard">
              <p className="eyebrow">Process Controls</p>
              <div className="toolbar">
                <button type="button" onClick={() => void interrupt()}>
                  Interrupt
                </button>
                <button type="button" className="danger" onClick={() => void abort()}>
                  Abort
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      <MessageComposer
        message={message}
        thinking={thinking}
        busy={busy}
        files={files}
        onMessageChange={setMessage}
        onThinkingChange={setThinking}
        onFilesChange={setFiles}
        onSend={send}
      />
    </section>
  );
}
