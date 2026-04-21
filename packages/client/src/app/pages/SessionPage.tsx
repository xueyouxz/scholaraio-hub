import type { PermissionMode } from "@scholaraio-hub/shared";
import { Bell, Check, PenLine, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../core/api";
import type { ModelInfo, ThinkingOption, UploadedFile } from "../../core/types";
import { MessageComposer } from "../../features/session/components/MessageComposer";
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
        <SessionPageContent projectId={projectId} sessionId={sessionId} />
      </StreamingMarkdownProvider>
    </SessionMetadataProvider>
  );
}

function SessionPageContent({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
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
    reconcile,
    loadOlderMessages,
    setPendingInputRequest,
    permissionMode,
    slashCommands,
  } = useSession({
    projectId,
    sessionId,
    streamingMarkdownCallbacks: streamingCallbacks,
  });

  useEffect(() => {
    if (permissionMode) setComposerPermissionMode(permissionMode);
  }, [permissionMode]);

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

  const title = session?.customTitle ?? session?.title ?? sessionId;

  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);

  return (
    <section className="flex flex-col gap-3 min-h-[calc(100vh-6rem)]">
      <div className="flex-1 min-h-0">
        <div className="flex flex-col gap-3">
          {pendingInputRequest ? (
            <div className="rounded-[20px] border border-outline-variant/20 bg-surface-container-low p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-secondary-container text-primary shrink-0 mt-0.5">
                  <Bell className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="text-sm font-semibold">Pending Input</strong>
                  <p className="mt-0.5 text-sm text-on-surface-variant">
                    {pendingInputRequest.toolName ?? pendingInputRequest.prompt}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-10">
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("approve")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-primary text-on-primary border-0 cursor-pointer hover:opacity-90"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("approve_accept_edits")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-container border border-outline-variant/20 cursor-pointer hover:bg-surface-container-high"
                >
                  <PenLine className="w-3.5 h-3.5" />
                  Approve + Accept Edits
                </button>
                <button
                  type="button"
                  onClick={() => void respondToPendingInput("deny")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-error bg-error-container/30 border border-error/20 cursor-pointer hover:bg-error-container/50"
                >
                  <X className="w-3.5 h-3.5" />
                  Deny
                </button>
              </div>
            </div>
          ) : null}

          {error ? <div className="empty text-sm text-error">{error}</div> : null}
          {sendError ? <div className="empty text-sm text-error">{sendError}</div> : null}
          {loading ? (
            <div className="empty text-sm text-on-surface-variant">Loading session…</div>
          ) : null}

          <MessageList
            messages={messages}
            markdownAugments={markdownAugments}
            pagination={pagination}
            loadingOlder={loadingOlder}
            onLoadOlderMessages={loadOlderMessages}
            sessionProvider={session?.provider}
          />
        </div>
      </div>

      <footer className="sticky bottom-0 z-20 pt-0 pb-4 bg-surface">
        <MessageComposer
          message={message}
          thinking={thinking}
          busy={busy}
          files={files}
          model={selectedModel}
          models={models}
          permissionMode={composerPermissionMode}
          isHeld={isHeld}
          draftKey={`session:${sessionId}`}
          slashCommands={slashCommands}
          contextUsage={session?.contextUsage}
          onMessageChange={setMessage}
          onThinkingChange={setThinking}
          onFilesChange={setFiles}
          onModelChange={(m) => void handleModelChange(m)}
          onPermissionModeChange={setComposerPermissionMode}
          onHoldChange={setIsHeld}
          onSend={send}
        />
      </footer>
    </section>
  );
}
