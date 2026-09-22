import type { StoredSession } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { useState } from "react";
import { useNavigationLayout } from "../../app/components/NavigationLayout";
import { settingsApi } from "../../core/library";
import { PaperReaderView } from "../library/reader/PaperReaderView";
import { Composer } from "./components/Composer";
import { ExecutionControls } from "./components/ExecutionControls";
import { InputRequestPanel } from "./components/InputRequestPanel";
import { ModelSwitcher } from "./components/ModelSwitcher";
import { ResizableProjectFilesPanel } from "./components/ProjectFilesPanel";
import { SessionHeader, type SessionPanel } from "./components/SessionHeader";
import { SessionMessages } from "./components/SessionMessages";
import { ResizableWorkspacePapersPanel } from "./components/WorkspacePapersPanel";
import { useSessionChat } from "./hooks/useSessionChat";
import { useStickToBottom } from "./hooks/useStickToBottom";
import { modelOptions } from "./modelOptions";

/** An open session: header, transcript, composer and the side panels. */
export function SessionChatView({ initial }: { initial: StoredSession }) {
  const { isDesktop } = useNavigationLayout();
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) => settingsApi.providers(signal),
    staleTime: 60_000,
  });
  const session = useSessionChat(initial);
  const { snapshot, running } = session;
  const scroll = useStickToBottom(running);
  const [panel, setPanel] = useState<SessionPanel | undefined>();
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);

  const currentTool = providers.data?.providers.find((tool) => tool.name === initial.provider);
  const pending = snapshot?.pendingInput;
  // Ask on the tool call's own row when it is on screen; otherwise (no call id,
  // or the paper reader is covering the transcript) fall back to the panel.
  const askedInline =
    !!pending?.toolCallId &&
    !selectedPaper &&
    !!session.messages
      .at(-1)
      ?.parts.some(
        (part) => part.type === "dynamic-tool" && part.toolCallId === pending.toolCallId,
      );
  const model = snapshot?.model;
  const optionsLocked = running || session.changeOptions.isPending;
  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      <section className="session-page flex-1 min-w-0">
        <SessionHeader
          title={snapshot?.title ?? initial.title}
          provider={initial.provider}
          model={model}
          state={session.state}
          running={running}
          inset={!isDesktop}
          panel={panel}
          hasPapers={!!initial.projectId}
          onTogglePanel={(next) => setPanel((current) => (current === next ? undefined : next))}
        />
        {pending && !askedInline ? (
          <InputRequestPanel
            key={pending.id}
            request={pending}
            sessionId={initial.id}
            onDone={session.refresh}
          />
        ) : null}
        {selectedPaper ? (
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PaperReaderView paperId={selectedPaper} onClose={() => setSelectedPaper(null)} />
          </main>
        ) : (
          <main
            ref={scroll.viewportRef}
            className={`session-messages${pending && !askedInline ? " session-messages-with-approval" : ""}`}
          >
            <div ref={scroll.contentRef}>
              {session.failure ? (
                <div
                  role="alert"
                  className="max-w-[830px] mx-auto mb-3 text-sm text-error break-words"
                >
                  {session.failure.message}
                  <button
                    type="button"
                    className="ml-2 underline"
                    disabled={session.reconnect.isPending}
                    onClick={() => session.reconnect.mutate()}
                  >
                    重新连接
                  </button>
                </div>
              ) : null}
              {snapshot?.error && !session.busy ? (
                <div className="max-w-[830px] mx-auto mb-3 text-sm text-error break-words">
                  {snapshot.error}
                </div>
              ) : null}
              <SessionMessages
                messages={session.messages}
                streaming={session.busy}
                processing={running && !pending}
                queued={(snapshot?.queuedMessages ?? []).map((message) => ({
                  id: message.id,
                  text: message.text || `${message.attachmentIds.length} 个附件`,
                }))}
                queuePaused={snapshot?.queuePaused}
                onCancelQueued={(messageId) =>
                  session.editQueue.mutate({ action: "remove", messageId })
                }
                pendingInput={askedInline ? pending : undefined}
                sessionId={initial.id}
                onInputDone={session.refresh}
              />
              {snapshot?.queuePaused ? (
                <div className="flex justify-center -mt-2 mb-2">
                  <button
                    type="button"
                    className="load-older-button"
                    disabled={session.editQueue.isPending}
                    onClick={() => session.editQueue.mutate({ action: "resume" })}
                  >
                    继续队列
                  </button>
                </div>
              ) : null}
            </div>
            {scroll.atBottom ? null : (
              <button
                type="button"
                className="scroll-to-bottom"
                aria-label="滚动到最新消息"
                title="滚动到最新消息"
                onClick={() => scroll.scrollToBottom("smooth")}
              >
                <ArrowDown size={15} />
              </button>
            )}
          </main>
        )}
        {selectedPaper ? null : (
          <footer className="session-input pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className={`session-connection-bar session-connection-${session.connection}`} />
            <div className="session-input-inner">
              {initial.readOnly ? (
                <p className="text-sm text-on-surface-variant py-3">
                  这是导入的只读历史。新建会话后可继续提问。
                </p>
              ) : (
                <Composer
                  provider={initial.provider}
                  sessionId={initial.id}
                  draftKey={`session:${initial.id}`}
                  running={running}
                  thinking={running && session.state !== "waiting-input"}
                  placeholder={running ? "Queue a follow-up message" : "Continue this session"}
                  onStop={() => session.stop.mutate()}
                  stopPending={session.stop.isPending}
                  onQueue={session.enqueue}
                  onSend={(text, files) => {
                    scroll.scrollToBottom();
                    return session.send(text, files);
                  }}
                  toolbar={
                    <ExecutionControls
                      permissionMode={snapshot?.permissionMode ?? "default"}
                      thinking={snapshot?.thinking ?? "auto"}
                      onChange={(value) => session.changeOptions.mutate(value)}
                      disabled={optionsLocked}
                      supportsThinking={currentTool?.supportsThinkingToggle ?? true}
                      supportsPermission={currentTool?.supportsPermissionMode ?? true}
                    />
                  }
                  trailing={
                    <>
                      {session.changeOptions.error ? (
                        <span role="alert" className="text-error text-xs">
                          {session.changeOptions.error.message}
                        </span>
                      ) : null}
                      <ModelSwitcher
                        model={model || "default"}
                        models={modelOptions(currentTool?.models)}
                        disabled={optionsLocked}
                        onModelChange={(value) =>
                          session.changeOptions
                            .mutateAsync({ model: value === "default" ? "" : value })
                            .then(() => {})
                        }
                      />
                    </>
                  }
                />
              )}
            </div>
          </footer>
        )}
      </section>
      <ResizableProjectFilesPanel
        open={panel === "files"}
        projectId={initial.id}
        rootName="会话工作目录"
        onClose={() => setPanel(undefined)}
      />
      {initial.projectId ? (
        <ResizableWorkspacePapersPanel
          open={panel === "papers"}
          workspaceName={initial.projectId}
          selectedPaperId={selectedPaper}
          onSelectPaper={(id) => {
            setSelectedPaper(id);
            if (!isDesktop) setPanel(undefined);
          }}
          onClose={() => setPanel(undefined)}
        />
      ) : null}
    </div>
  );
}
