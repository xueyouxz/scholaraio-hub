import {
  type LiteratureRef,
  type SessionDetail,
  type SessionMessage,
  mergeReferences,
  sameReference,
} from "@scholaraio-hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ownAttachments,
  sessionApi,
  sessionInput,
  sessionQuery,
  sessionUrl,
} from "../../core/sessions";
import { useNavigationLayout } from "../../shared/layout";
import { PaperReaderView } from "../library/reader/PaperReaderView";
import { SessionFileLinks } from "./components/FileViewerDialog";
import { InputRequestPrompt } from "./components/InputRequestPrompt";
import { ReferenceChips } from "./components/ReferenceChips";
import { ResizableReferencesPanel } from "./components/ReferencesPanel";
import { ResizableSessionFilesPanel } from "./components/SessionFilesPanel";
import { SessionHeader, type SessionPanel } from "./components/SessionHeader";
import { SessionMessages } from "./components/SessionMessages";
import { useProviders } from "./composer/hooks/useProviders";
import { rememberComposerChoice } from "./composer/model/preferences";
import { Composer, type EditedPrompt } from "./composer/ui/Composer";
import type { ComposerControls } from "./composer/ui/ComposerOptions";
import { useSessionChat } from "./hooks/useSessionChat";
import { useStickToBottom } from "./hooks/useStickToBottom";

/** An open session: header, transcript, composer and the side panels. */
export function SessionChatView({ initial }: { initial: SessionDetail }) {
  const { isDesktop } = useNavigationLayout();
  const providers = useProviders();
  const session = useSessionChat(initial);
  const { snapshot, running } = session;
  const scroll = useStickToBottom(running);
  const navigate = useNavigate();
  const [panel, setPanel] = useState<SessionPanel | undefined>();
  const literature = useSessionReferences(
    initial.id,
    session.snapshot?.references ?? initial.references,
  );
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);
  /** The last prompt, brought back into the composer to be corrected. */
  const [editing, setEditing] = useState<EditedPrompt>();
  const edit = (message: SessionMessage) =>
    setEditing({
      id: message.id,
      text: sessionInput(initial.id, message).text,
      attachments: ownAttachments(initial.id, message),
    });

  const pending = snapshot?.pendingInput;
  // Ask on the tool call's own row when it is on screen; otherwise (no call id,
  // or the paper reader is covering the transcript) pin the prompt over it.
  const askedInline =
    !!pending?.toolCallId &&
    !selectedPaper &&
    !!session.messages
      .at(-1)
      ?.parts.some(
        (part) => part.type === "dynamic-tool" && part.toolCallId === pending.toolCallId,
      );
  const model = snapshot?.model;
  // Options may change mid-turn; the server applies them when the next turn starts.
  const controls: ComposerControls = {
    provider: initial.provider,
    info: providers.find(initial.provider),
    options: {
      model: snapshot?.model,
      // A session the Hub has not run yet starts in the default mode, as the server launches it.
      permissionMode: snapshot?.permissionMode ?? "default",
      thinking: snapshot?.thinking,
      effort: snapshot?.effort,
    },
    onChange: (patch) => {
      // The next new chat with this agent opens on the same choice.
      rememberComposerChoice(initial.provider, patch);
      session.changeOptions.mutate(patch);
    },
    disabled: session.changeOptions.isPending,
    pending: !!snapshot?.pendingOptions?.length,
    error: session.changeOptions.error?.message,
    contextUsage: snapshot?.contextUsage,
  };
  return (
    <SessionFileLinks sessionId={initial.id} cwd={initial.cwd}>
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
            references={literature.references.length}
            onTogglePanel={(next) => setPanel((current) => (current === next ? undefined : next))}
          />
          {pending && !askedInline ? (
            <InputRequestPrompt
              key={pending.id}
              request={pending}
              sessionId={initial.id}
              placement="floating"
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
                {snapshot?.error && !session.streaming ? (
                  <div className="max-w-[830px] mx-auto mb-3 text-sm text-error break-words">
                    {snapshot.error}
                  </div>
                ) : null}
                <SessionMessages
                  messages={session.messages}
                  streaming={session.streaming}
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
                  provider={initial.provider}
                  promptActions={{
                    busy: running || session.fork.isPending,
                    onEdit: edit,
                    onFork: (message) =>
                      session.fork.mutate(message.id, {
                        onSuccess: (fork) => navigate(sessionUrl(fork.id)),
                      }),
                  }}
                  editingId={editing?.id}
                />
                {snapshot?.queuePaused ? (
                  <div className="flex justify-center -mt-2 mb-2">
                    <button
                      type="button"
                      className="queue-resume-button"
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
                {snapshot?.external ? (
                  <p className="text-xs text-attention pb-1.5">
                    另一个程序（如终端里的 CLI）正在使用这个会话；在这里继续可能与它冲突。
                  </p>
                ) : null}
                <div className="mb-1.5 empty:hidden">
                  <ReferenceChips
                    references={literature.references}
                    disabled={literature.changing}
                    onRemove={literature.remove}
                  />
                </div>
                <Composer
                  provider={initial.provider}
                  sessionId={initial.id}
                  draftKey={`session:${initial.id}`}
                  run={{
                    running,
                    stoppable: running && session.state !== "waiting-input",
                    onStop: () => session.stop.mutate(),
                    stopPending: session.stop.isPending,
                    onQueue: (text, attachments) =>
                      literature.sendWith((refs) => session.enqueue(text, attachments, refs)),
                  }}
                  placeholder={running ? "Queue a follow-up message" : "Continue this session"}
                  onSend={(text, attachments) => {
                    scroll.scrollToBottom();
                    return literature.sendWith((refs) =>
                      session.send(text, attachments, editing?.id, refs),
                    );
                  }}
                  onReference={literature.add}
                  editing={editing}
                  onEditEnd={() => setEditing(undefined)}
                  controls={controls}
                />
              </div>
            </footer>
          )}
        </section>
        <ResizableSessionFilesPanel
          open={panel === "files"}
          sessionId={initial.id}
          rootName={initial.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "工作目录"}
          onClose={() => setPanel(undefined)}
        />
        <ResizableReferencesPanel
          open={panel === "papers"}
          references={literature.references}
          selectedPaperId={selectedPaper}
          onSelectPaper={(id) => {
            setSelectedPaper(id);
            if (!isDesktop) setPanel(undefined);
          }}
          onRemove={literature.remove}
          disabled={literature.changing}
          onClose={() => setPanel(undefined)}
        />
      </div>
    </SessionFileLinks>
  );
}

/**
 * The literature a session refers to as this page edits it: what the session
 * keeps, plus what was referred to with `@` since the last message, which goes
 * with the next one.
 */
function useSessionReferences(sessionId: string, kept: LiteratureRef[]) {
  const client = useQueryClient();
  const [added, setAdded] = useState<LiteratureRef[]>([]);
  const references = mergeReferences(kept, added);
  const change = useMutation({
    mutationFn: (next: LiteratureRef[]) => sessionApi.setReferences(sessionId, next),
    onSuccess: (detail) => client.setQueryData(sessionQuery(sessionId).queryKey, detail),
  });
  return {
    references,
    /** The kept list is being saved. */
    changing: change.isPending,
    /** Refer to one more with the next message. */
    add: (ref: LiteratureRef) => {
      if (!references.some((item) => sameReference(item, ref)))
        setAdded((current) => [...current, ref]);
    },
    /** Stop referring to one: one not sent yet is simply dropped. */
    remove: (removed: LiteratureRef) => {
      if (added.some((ref) => sameReference(ref, removed))) {
        setAdded((current) => current.filter((ref) => !sameReference(ref, removed)));
        return;
      }
      change.mutate(kept.filter((ref) => !sameReference(ref, removed)));
    },
    /** Send what was added with this message, and forget it once the session has it. */
    sendWith: async <T,>(sendIt: (refs: LiteratureRef[]) => Promise<T>) => {
      const sent = added;
      const result = await sendIt(sent);
      setAdded((current) =>
        current.filter((ref) => !sent.some((item) => sameReference(item, ref))),
      );
      return result;
    },
  };
}
