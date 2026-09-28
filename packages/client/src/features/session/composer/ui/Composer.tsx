import type { ProviderName, SessionAttachment, SlashCommand } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, Pencil } from "lucide-react";
import {
  type Dispatch,
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
import { useSlashCommandPicker } from "../hooks/useSlashCommandPicker";
import { type StagedAttachment, useStagedAttachments } from "../hooks/useStagedAttachments";
import { rejectAttachments } from "../model/attachments";
import { type ClientCommandName, clientCommands, isClientCommand } from "../model/clientCommands";
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
import { SlashCommandSuggestions } from "./SlashCommandSuggestions";
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
 * Shared message input:
 * attachments + provider option pills + voice on the left, model + send on the right.
 */
export function Composer({
  draftKey,
  provider,
  sessionId,
  cwd,
  onSend,
  onQueue,
  running = false,
  stoppable = running,
  onStop,
  stopPending = false,
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
  /** Receives the uploaded attachments; files upload as soon as they are added. */
  onQueue?: (text: string, attachments: SessionAttachment[]) => Promise<void>;
  onSend: (text: string, attachments: SessionAttachment[]) => Promise<void>;
  running?: boolean;
  /** Whether the running turn can be interrupted now (not while it waits for input). */
  stoppable?: boolean;
  onStop?: () => void;
  stopPending?: boolean;
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
  }, [editing, adopt, swap, setText]);
  /**
   * Leave the correction: the draft set aside comes back. Cancelling also
   * drops the files added for it; the prompt's own files were never touched.
   */
  const endEdit = (sent: boolean) => {
    const saved = setAside.current;
    setAside.current = undefined;
    if (!sent) for (const item of staged.items) if (!item.sent) staged.remove(item.key);
    latest.current = saved?.text ?? "";
    setText(latest.current);
    swap(saved?.items ?? []);
    onEditEnd?.();
  };
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
      {picker.showList && picker.matches ? (
        <SlashCommandSuggestions
          commands={picker.matches}
          activeIndex={picker.activeIndex}
          onHover={picker.setActiveIndex}
          onSelect={selectCommand}
        />
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
            if (picker.showList && picker.matches) {
              const list = picker.matches;
              const count = list.length;
              if (e.key === "Escape") {
                e.preventDefault();
                picker.dismiss();
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                picker.setActiveIndex(
                  (index) => (index + (e.key === "ArrowDown" ? 1 : -1) + count) % count,
                );
                return;
              }
              if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                picker.setActiveIndex(e.key === "Home" ? 0 : count - 1);
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey && !e.ctrlKey) || e.key === "Tab") {
                const command = list[picker.activeIndex] ?? list[0];
                if (command) {
                  e.preventDefault();
                  selectCommand(command);
                  return;
                }
              }
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
              busy={sending || stopPending}
              canSend={
                !disabled &&
                (!running || !!onQueue) &&
                !staged.failed &&
                hasContent(text, interim, staged.items.length)
              }
              isRunning={running}
              stoppable={stoppable}
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
