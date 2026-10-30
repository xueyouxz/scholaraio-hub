import type {
  LiteratureRef,
  ProviderName,
  SessionAttachment,
  SlashCommand,
} from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, Pencil } from "lucide-react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sessionApi } from "../../../../core/sessions";
import { useComposerDraft } from "../hooks/useComposerDraft";
import { useMentionPicker } from "../hooks/useMentionPicker";
import { useSlashCommandPicker } from "../hooks/useSlashCommandPicker";
import { type StagedAttachment, useStagedAttachments } from "../hooks/useStagedAttachments";
import { rejectAttachments } from "../model/attachments";
import { type ClientCommandName, clientCommands, isClientCommand } from "../model/clientCommands";
import { type MentionOption, mentionReplacement } from "../model/mentions";
import {
  dedupeCommands,
  joinLeadingCommand,
  replaceToken,
  tokenReplacement,
} from "../model/slashCommands";
import {
  appendTranscript,
  enterAction,
  hasContent,
  isTouchDevice,
  routeSubmission,
  withInterim,
} from "../model/submission";
import { typeaheadKey } from "../model/typeahead";
import { AttachmentTray } from "./AttachmentTray";
import {
  type ComposerControls,
  ComposerLeadingOptions,
  ComposerTrailingOptions,
  type MenuRequest,
  availableMenus,
} from "./ComposerOptions";
import { SendActionButton } from "./SendActionButton";
import { SlashCommandBadge } from "./SlashCommandBadge";
import { MentionSuggestions, SlashCommandSuggestions } from "./Suggestions";
import { VoiceInputButton, type VoiceInputButtonRef } from "./VoiceInputButton";

export { readComposerDraft } from "../hooks/useComposerDraft";

/**
 * The session's last prompt brought back to be corrected, with the files it
 * carried. The composer sets its draft aside and edits this prompt until the
 * correction is sent (it replaces the prompt and its reply) or cancelled.
 */
export interface EditedPrompt {
  /** The prompt's message id. */
  id: string;
  text: string;
  attachments: SessionAttachment[];
}

/**
 * The session's turn as the composer follows it: whether one runs, how to stop
 * it, and how to queue a message behind it. A new chat has none.
 */
export interface ComposerRun {
  running: boolean;
  /** Whether the running turn can be interrupted now (not while it waits for input); `running` if left out. */
  stoppable?: boolean;
  onStop?: () => void;
  stopPending?: boolean;
  /** Queue a message behind the running turn; it receives the uploaded attachments. */
  onQueue?: (text: string, attachments: SessionAttachment[]) => Promise<void>;
}

/**
 * Shared message input:
 * attachments + provider option pills + voice on the left, model + send on the right.
 */
export function Composer({
  draftKey,
  provider,
  sessionId,
  cwd,
  onReference,
  onSend,
  run,
  disabled = false,
  placeholder = "What would you like to build or change?",
  controls,
  text: controlledText,
  onTextChange,
  editing,
  onEditEnd,
}: {
  draftKey: string;
  provider: ProviderName;
  sessionId?: string;
  /** A new chat's directory, whose commands (project skills) it offers. */
  cwd?: string;
  /**
   * Refer to literature with `@`: a chosen collection or paper stays in the
   * message as `@name` and is handed here, to join the session's references.
   */
  onReference?: (reference: LiteratureRef) => void;
  /** Receives the uploaded attachments; files upload as soon as they are added. */
  onSend: (text: string, attachments: SessionAttachment[]) => Promise<void>;
  run?: ComposerRun;
  disabled?: boolean;
  placeholder?: string;
  /** Provider-described option pills; omitted, the composer shows none. */
  controls?: ComposerControls;
  text?: string;
  onTextChange?: Dispatch<SetStateAction<string>>;
  /** The prompt to correct; a new object each time an edit starts. */
  editing?: EditedPrompt;
  /** The correction was sent or cancelled; the parent clears `editing`. */
  onEditEnd?: () => void;
}) {
  const { text, setText, forget } = useComposerDraft(draftKey, {
    text: controlledText,
    onTextChange,
  });
  const running = run?.running ?? false;
  const { onQueue, onStop } = run ?? {};
  const commandsQuery = useQuery({
    queryKey: ["session-commands", provider, sessionId, cwd],
    queryFn: ({ signal }) => sessionApi.commands(provider, sessionId, signal, cwd),
    staleTime: 60000,
  });
  const menus = controls ? availableMenus(controls) : new Set<MenuRequest["menu"]>();
  const hasModel = menus.has("model");
  const hasEffort = menus.has("effort");
  const hasPermissions = menus.has("permissions");
  const canStop = running && !!onStop;
  const localCommands = useMemo(
    () =>
      clientCommands([
        ...(hasModel ? (["model"] as const) : []),
        ...(hasEffort ? (["effort"] as const) : []),
        ...(hasPermissions ? (["permissions"] as const) : []),
        "attach",
        ...(canStop ? (["stop"] as const) : []),
      ]),
    [hasModel, hasEffort, hasPermissions, canStop],
  );
  const commands = useMemo(
    () => dedupeCommands(localCommands, commandsQuery.data?.commands ?? []),
    [localCommands, commandsQuery.data],
  );
  /** Caret offset in the textarea's value; null keeps it at the end. */
  const [caret, setCaret] = useState<number | null>(null);
  const [menuRequest, setMenuRequest] = useState<MenuRequest>();
  const picker = useSlashCommandPicker(text, commands, caret);
  const mention = useMentionPicker(picker.messageBody, caret, !!onReference && !picker.open);
  const mentioning = mention.open && !picker.open;
  const fileInput = useRef<HTMLInputElement>(null);
  // A new chat has no session yet; its files go to the draft area until it is created.
  const staged = useStagedAttachments(sessionId ? { sessionId } : "draft");
  const voice = useRef<VoiceInputButtonRef>(null);
  const [interim, setInterim] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const inputId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const latest = useRef(text);
  latest.current = text;
  const endEdit = usePromptEdit(editing, onEditEnd, { latest, setText, staged, textarea });
  const placeCaret = (position: number) => {
    setCaret(position);
    window.requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
    });
  };
  const runClientCommand = (name: ClientCommandName) => {
    if (name === "attach") fileInput.current?.click();
    else if (name === "stop") onStop?.();
    else setMenuRequest((previous) => ({ menu: name, seq: (previous?.seq ?? 0) + 1 }));
  };
  /**
   * Complete the token at the caret: client commands run here and leave no
   * text; provider commands become `/name` (a leading badge) or `$name`.
   */
  const selectCommand = (command: SlashCommand) => {
    const token = picker.token;
    if (!token) return;
    picker.dismiss();
    const body = picker.messageBody;
    if (isClientCommand(command)) {
      const next = replaceToken(body, token, "");
      setText(joinLeadingCommand(picker.selectedToken, next.text));
      placeCaret(next.caret);
      runClientCommand(command.name);
      return;
    }
    const next = replaceToken(body, token, tokenReplacement(command));
    setText(joinLeadingCommand(picker.selectedToken, next.text));
    // A leading command turns into the badge; the caret goes to the start of the body.
    const becomesBadge = token.leading && (command.trigger ?? "/") === "/";
    placeCaret(becomesBadge ? 0 : next.caret);
  };
  /** Complete the `@` at the caret: the name stays in the message, the reference joins the session. */
  const selectMention = (option: MentionOption) => {
    const token = mention.token;
    if (!token) return;
    mention.dismiss();
    const next = replaceToken(
      picker.messageBody,
      { ...token, leading: false },
      mentionReplacement(option),
    );
    setText(joinLeadingCommand(picker.selectedToken, next.text));
    placeCaret(next.caret);
    onReference?.(option.ref);
  };
  const addFiles = (incoming: File[]) => {
    if (disabled || sending) return;
    const rejection = rejectAttachments(
      staged.items.length,
      incoming,
      controls?.info?.capabilities.attachments,
    );
    setError(rejection);
    if (rejection) return;
    staged.add(incoming);
  };
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });
  const submit = async (queue = false) => {
    const route = routeSubmission({ running, wantsQueue: queue, canQueue: !!onQueue });
    if (
      !hasContent(text, interim, staged.items.length) ||
      !route ||
      submitting.current ||
      disabled ||
      composing.current
    )
      return;
    const pendingVoice = voice.current?.stopAndFinalize() ?? "";
    const submitted = pendingVoice ? appendTranscript(text, pendingVoice).trim() : text;
    if (pendingVoice) {
      setText(submitted);
      latest.current = submitted;
    }
    setInterim("");
    submitting.current = true;
    setSending(true);
    setError(undefined);
    let taken: ReturnType<typeof staged.take> | undefined;
    try {
      const attachments = await staged.settle();
      // The transcript shows the message as soon as it is handed off, which can be
      // long before the send resolves; empty the input and the tray now and restore
      // them on failure.
      const send = (route === "queue" && onQueue ? onQueue : onSend)(submitted, attachments);
      taken = staged.take();
      if (latest.current === submitted) {
        setText("");
        latest.current = "";
      }
      await send;
      taken.commit();
      if (editing) endEdit(true);
      // New-session submission unmounts this composer, so clear storage here too.
      if (!latest.current) forget();
      textarea.current?.focus();
    } catch (error) {
      // Put the failed message back unless the user has started a new one meanwhile.
      if (taken) {
        taken.restore();
        if (!latest.current) {
          setText(submitted);
          latest.current = submitted;
        }
      }
      setError(error instanceof Error ? error.message : "Could not send. Try again.");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const attachmentCount = staged.items.length;
  return (
    <div className="relative w-full" aria-label="Message composer">
      {picker.open ? <SlashCommandSuggestions menu={picker} onSelect={selectCommand} /> : null}
      {mentioning ? (
        <MentionSuggestions menu={mention} loading={mention.loading} onSelect={selectMention} />
      ) : null}
      {editing ? (
        <div className="mb-1.5 flex items-center justify-between gap-3 px-1 text-xs text-on-surface-variant">
          <span className="flex min-w-0 items-center gap-1.5">
            <Pencil size={12} aria-hidden="true" className="shrink-0 text-primary" />
            <span className="truncate">正在编辑上一条消息，发送后将替换它和之后的回复</span>
          </span>
          <button
            type="button"
            onClick={() => endEdit(false)}
            className="shrink-0 rounded-md px-2 py-0.5 text-on-surface hover:bg-surface-container transition-colors"
          >
            取消 (Esc)
          </button>
        </div>
      ) : null}
      <form
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
        data-provider={provider}
        className={`hub-composer bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all ${interim ? "ring-1 ring-error/30 border-error/30" : editing ? "ring-1 ring-primary/30 border-primary/30" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <AttachmentTray
          items={staged.items}
          disabled={sending}
          onRemove={staged.remove}
          onRetry={staged.retry}
        />
        {picker.showBadge && picker.selectedCommand ? (
          <SlashCommandBadge token={picker.selectedToken} command={picker.selectedCommand} />
        ) : null}
        <label className="sr-only" htmlFor={inputId}>
          Message
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          name="message"
          className="block w-full bg-transparent text-sm text-on-surface px-4 pt-3 pb-1 resize-none outline-none border-none placeholder:text-on-surface-variant/50 min-h-[48px] max-h-[45vh] leading-relaxed"
          rows={2}
          maxLength={50000}
          readOnly={disabled}
          value={withInterim(picker.messageBody, interim)}
          onChange={(e) => {
            setInterim("");
            picker.resume();
            mention.resume();
            setCaret(e.target.selectionStart);
            const next = e.target.value;
            setText(joinLeadingCommand(picker.selectedToken, next));
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault();
              addFiles(Array.from(event.clipboardData.files));
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            const isComposing = e.nativeEvent.isComposing || composing.current || e.keyCode === 229;
            if (isComposing) return;
            // An open menu takes the keys it steers by before the textarea does.
            if (
              typeaheadKey(e, picker, selectCommand) ||
              typeaheadKey(e, { ...mention, open: mentioning }, selectMention)
            ) {
              e.preventDefault();
              return;
            }
            // Open suggestions take Escape first; then it cancels a correction.
            if (e.key === "Escape" && editing) {
              e.preventDefault();
              endEdit(false);
              return;
            }
            if (e.key === "Backspace" && picker.showBadge && picker.messageBody.length === 0) {
              e.preventDefault();
              setText("");
              picker.resume();
              return;
            }
            if (e.key !== "Enter") return;
            const action = enterAction({
              shiftKey: e.shiftKey,
              ctrlKey: e.ctrlKey,
              touch: isTouchDevice(),
            });
            if (action === "newline") return;
            if (action === "queue") {
              if (onQueue) {
                e.preventDefault();
                void submit(true);
              }
              return;
            }
            e.preventDefault();
            void submit();
          }}
          placeholder={placeholder}
        />
        <div className="flex items-center justify-between px-2.5 pb-1.5 gap-2">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              disabled={disabled || sending}
              onClick={() => fileInput.current?.click()}
              className="relative p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors disabled:opacity-40"
            >
              <Paperclip size={15} aria-hidden="true" />
              {attachmentCount > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-primary text-on-primary text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {attachmentCount}
                </span>
              ) : null}
            </button>
            <VoiceInputButton
              ref={voice}
              disabled={disabled || sending}
              onListeningStart={() => textarea.current?.focus()}
              onInterimTranscript={setInterim}
              onFinalTranscript={(transcript) => {
                setText((previous) => appendTranscript(previous, transcript));
                setInterim("");
              }}
            />
            <div className="hub-composer-options flex items-center gap-0.5 min-w-0 overflow-x-auto">
              {controls ? (
                <ComposerLeadingOptions controls={controls} request={menuRequest} />
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {controls ? (
              <ComposerTrailingOptions controls={controls} request={menuRequest} />
            ) : null}
            <SendActionButton
              busy={sending || !!run?.stopPending}
              canSend={
                !disabled &&
                (!running || !!onQueue) &&
                !staged.failed &&
                hasContent(text, interim, staged.items.length)
              }
              isRunning={running}
              stoppable={run?.stoppable ?? running}
              hasQueueAction={!!onQueue}
              hasStopAction={!!onStop}
              onSend={() => void submit()}
              onQueue={onQueue ? () => void submit(true) : undefined}
              onStop={onStop}
            />
          </div>
        </div>
      </form>
      <input
        type="file"
        multiple
        className="hidden"
        ref={fileInput}
        aria-label="Choose files"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {commandsQuery.error && text.startsWith("/") ? (
        <p role="alert" className="text-xs text-error mt-2">
          Could not load commands: {commandsQuery.error.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-error text-xs mt-2 break-words">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Correcting the session's last prompt in place of the draft: when `editing`
 * arrives the draft and its files are set aside and the prompt takes their
 * place; the returned `endEdit` brings them back once the correction is sent
 * or cancelled.
 */
function usePromptEdit(
  editing: EditedPrompt | undefined,
  onEditEnd: (() => void) | undefined,
  {
    latest,
    setText,
    staged,
    textarea,
  }: {
    /** The text in the input now, ahead of the next render. */
    latest: RefObject<string>;
    setText: (text: string) => void;
    staged: ReturnType<typeof useStagedAttachments>;
    textarea: RefObject<HTMLTextAreaElement | null>;
  },
) {
  /** The draft set aside while the prompt is corrected; it comes back afterwards. */
  const setAside = useRef<{ text: string; items: StagedAttachment[] }>(undefined);
  const started = useRef<EditedPrompt>(undefined);
  const { adopt, swap } = staged;
  useEffect(() => {
    if (!editing || started.current === editing) return;
    started.current = editing;
    setAside.current ??= { text: latest.current, items: swap([]) };
    latest.current = editing.text;
    setText(editing.text);
    adopt(editing.attachments);
    textarea.current?.focus();
  }, [editing, adopt, swap, setText, latest, textarea]);
  /**
   * Leave the correction: the draft set aside comes back. Cancelling also
   * drops the files added for it; the prompt's own files were never touched.
   */
  return (sent: boolean) => {
    const saved = setAside.current;
    setAside.current = undefined;
    if (!sent) for (const item of staged.items) if (!item.sent) staged.remove(item.key);
    latest.current = saved?.text ?? "";
    setText(latest.current);
    swap(saved?.items ?? []);
    onEditEnd?.();
  };
}
