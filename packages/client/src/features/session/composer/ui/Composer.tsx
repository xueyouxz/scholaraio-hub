import type { SessionAttachment, SlashCommand } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sessionApi } from "../../../../core/library";
import { useComposerDraft } from "../hooks/useComposerDraft";
import { useSlashCommandPicker } from "../hooks/useSlashCommandPicker";
import { useStagedAttachments } from "../hooks/useStagedAttachments";
import { rejectAttachments } from "../model/attachments";
import { type ClientCommandName, clientCommands, isClientCommand } from "../model/clientCommands";
import {
  dedupeCommands,
  joinLeadingCommand,
  mergeCommands,
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
 * Shared message input:
 * attachments + provider option pills + voice on the left, model + send on the right.
 */
export function Composer({
  draftKey,
  provider,
  sessionId,
  onSend,
  onQueue,
  running = false,
  thinking = running,
  onStop,
  stopPending = false,
  disabled = false,
  placeholder = "What would you like to build or change?",
  controls,
  extraCommands,
  text: controlledText,
  onTextChange,
}: {
  draftKey: string;
  provider: "claude" | "codex";
  sessionId?: string;
  /** Receives the uploaded attachments; files upload as soon as they are added. */
  onQueue?: (text: string, attachments: SessionAttachment[]) => Promise<void>;
  onSend: (text: string, attachments: SessionAttachment[]) => Promise<void>;
  running?: boolean;
  thinking?: boolean;
  onStop?: () => void;
  stopPending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Provider-described option pills; omitted, the composer shows none. */
  controls?: ComposerControls;
  extraCommands?: SlashCommand[];
  text?: string;
  onTextChange?: Dispatch<SetStateAction<string>>;
}) {
  const { text, setText, forget } = useComposerDraft(draftKey, {
    text: controlledText,
    onTextChange,
  });
  const skills = useQuery({
    queryKey: ["session-commands", provider, sessionId],
    queryFn: ({ signal }) => sessionApi.commands(provider, sessionId, signal),
    staleTime: 60000,
  });
  const menus = controls ? availableMenus(controls) : new Set<MenuRequest["menu"]>();
  const available: ClientCommandName[] = [
    ...(menus.has("model") ? (["model"] as const) : []),
    ...(menus.has("effort") ? (["effort"] as const) : []),
    ...(menus.has("permissions") ? (["permissions"] as const) : []),
    "attach",
    ...(running && onStop ? (["stop"] as const) : []),
  ];
  const clientKey = available.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for `available`.
  const localCommands = useMemo(() => clientCommands(available), [clientKey]);
  const commands = useMemo(
    () => dedupeCommands(localCommands, mergeCommands(skills.data?.commands ?? [], extraCommands)),
    [localCommands, skills.data, extraCommands],
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
    try {
      const attachments = await staged.settle();
      await (route === "queue" && onQueue ? onQueue : onSend)(submitted, attachments);
      staged.clear();
      if (latest.current === submitted) {
        setText("");
        // New-session submission unmounts this composer, so clear storage here too.
        forget();
      }
      textarea.current?.focus();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send. Try again.");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const attachmentCount = staged.items.length;
  return (
    <div className="relative w-full" aria-label="Message composer">
      {picker.showList && picker.filter ? (
        <SlashCommandSuggestions
          commands={picker.filter}
          activeIndex={picker.activeIndex}
          onHover={picker.setActiveIndex}
          onSelect={selectCommand}
        />
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
        className={`hub-composer bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all ${interim ? "ring-1 ring-error/30 border-error/30" : ""}`}
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
            if (picker.showList && picker.filter) {
              const list = picker.filter;
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
        <div className="flex items-center justify-between px-3 pb-2 gap-2">
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
              isThinking={thinking}
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
      {skills.error && text.startsWith("/") ? (
        <p role="alert" className="text-xs text-error mt-2">
          Could not load commands: {skills.error.message}
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
