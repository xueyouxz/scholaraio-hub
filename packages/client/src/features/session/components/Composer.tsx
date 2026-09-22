import type { SlashCommand } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sessionApi } from "../../../core/library";

import { useSlashCommandPicker } from "../hooks/useSlashCommandPicker";
import { VoiceInputButton, type VoiceInputButtonRef } from "./VoiceInputButton";
import { SendActionButton } from "./composer/SendActionButton";
import { SlashCommandBadge } from "./composer/SlashCommandBadge";
import { SlashCommandSuggestions } from "./composer/SlashCommandSuggestions";

const draftStorageKey = (draftKey: string) => `hub-composer:${draftKey}`;

export function readComposerDraft(draftKey: string): string {
  try {
    return sessionStorage.getItem(draftStorageKey(draftKey)) ?? "";
  } catch (error) {
    console.warn("无法读取会话草稿", error);
    return "";
  }
}

/**
 * Shared message input with the pre-refactor MessageInput layout:
 * attachments + execution pills + voice on the left, model + send on the right.
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
  placeholder = "您想更改或创建什么内容？",
  toolbar,
  trailing,
  extraCommands,
  text: controlledText,
  onTextChange,
}: {
  draftKey: string;
  provider: "claude" | "codex";
  sessionId?: string;
  onQueue?: (text: string, files: File[]) => Promise<void>;
  onSend: (text: string, files: File[]) => Promise<void>;
  running?: boolean;
  thinking?: boolean;
  onStop?: () => void;
  stopPending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Execution pills rendered after the attachment button. */
  toolbar?: ReactNode;
  /** Controls rendered before the send button (model switcher). */
  trailing?: ReactNode;
  extraCommands?: SlashCommand[];
  text?: string;
  onTextChange?: Dispatch<SetStateAction<string>>;
}) {
  const storageKey = draftStorageKey(draftKey);
  const [innerText, setInnerText] = useState(() =>
    controlledText === undefined ? readComposerDraft(draftKey) : "",
  );
  const text = controlledText ?? innerText;
  const setText = onTextChange ?? setInnerText;
  const skills = useQuery({
    queryKey: ["session-commands", provider, sessionId],
    queryFn: ({ signal }) => sessionApi.commands(provider, sessionId, signal),
    staleTime: 60000,
  });
  const commands = useMemo(() => {
    const base = skills.data?.commands ?? [];
    if (!extraCommands?.length) return base;
    const known = new Set(base.map((command) => command.name));
    return [...base, ...extraCommands.filter((command) => !known.has(command.name))];
  }, [skills.data, extraCommands]);
  const picker = useSlashCommandPicker(text, commands);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
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
  const selectCommand = (command: SlashCommand) => {
    setText(`/${command.name} `);
    picker.dismiss();
    window.requestAnimationFrame(() => textarea.current?.focus());
  };
  const addFiles = (incoming: File[]) => {
    if (disabled || sending) return;
    if (incoming.some((file) => !file.size || file.size > 25 * 1024 * 1024)) {
      setError("附件不能为空，且单个文件不能超过 25 MB");
      return;
    }
    if (files.length + incoming.length > 10) {
      setError("每条消息最多添加 10 个附件");
      return;
    }
    setError(undefined);
    setFiles((current) => [...current, ...incoming]);
  };
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(storageKey, text);
      else sessionStorage.removeItem(storageKey);
    } catch (error) {
      console.warn("无法保存会话草稿", error);
    }
  }, [text, storageKey]);
  const submit = async (queue = false) => {
    if (
      (!(text + interim).trim() && files.length === 0) ||
      (running && !onQueue) ||
      (queue && !onQueue) ||
      submitting.current ||
      disabled ||
      composing.current
    )
      return;
    const pendingVoice = voice.current?.stopAndFinalize() ?? "";
    const submitted = pendingVoice ? `${text.trimEnd()} ${pendingVoice}`.trim() : text;
    if (pendingVoice) {
      setText(submitted);
      latest.current = submitted;
    }
    setInterim("");
    submitting.current = true;
    setSending(true);
    setError(undefined);
    try {
      await ((queue || running) && onQueue ? onQueue : onSend)(submitted, files);
      setFiles([]);
      if (latest.current === submitted) {
        setText("");
        // New-session submission unmounts this composer, so clear storage here too.
        try {
          sessionStorage.removeItem(storageKey);
        } catch (error) {
          console.warn("无法清除会话草稿", error);
        }
      }
      textarea.current?.focus();
    } catch (error) {
      setError(error instanceof Error ? error.message : "发送失败，请重试。");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  const attachmentCount = files.length;
  return (
    <div className="relative w-full" aria-label="会话输入区">
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
        className={`hub-composer bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 ${interim ? "ring-1 ring-error/30 border-error/30" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1" aria-label="附件">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="inline-flex items-center gap-1.5 max-w-[180px] px-2.5 py-1 bg-surface-container border border-outline-variant/20 rounded-lg text-xs text-on-surface-variant"
              >
                <span className="truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`移除 ${file.name}`}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {picker.showBadge && picker.selectedCommand ? (
          <SlashCommandBadge token={picker.selectedToken} command={picker.selectedCommand} />
        ) : null}
        <label className="sr-only" htmlFor={inputId}>
          输入问题
        </label>
        <textarea
          ref={textarea}
          id={inputId}
          name="message"
          className="block w-full bg-transparent text-sm text-on-surface px-4 pt-3 pb-2 resize-none outline-none border-none placeholder:text-on-surface-variant/50 min-h-[60px] max-h-[45vh] leading-relaxed"
          rows={2}
          maxLength={50000}
          readOnly={disabled}
          value={
            interim ? `${picker.messageBody.trimEnd()} ${interim}`.trimStart() : picker.messageBody
          }
          onChange={(e) => {
            setInterim("");
            picker.resume();
            const next = e.target.value;
            setText(picker.showBadge ? `${picker.selectedToken}${next ? ` ${next}` : " "}` : next);
          }}
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
            if (e.key !== "Enter" || e.shiftKey) return;
            if (e.ctrlKey) {
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
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              aria-label="添加附件"
              title="添加附件"
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
            <div className="flex items-center gap-0.5 flex-wrap">
              {toolbar}
              <VoiceInputButton
                ref={voice}
                disabled={disabled || sending}
                onListeningStart={() => textarea.current?.focus()}
                onInterimTranscript={setInterim}
                onFinalTranscript={(transcript) => {
                  setText((previous) => `${previous.trimEnd()} ${transcript}`.trimStart());
                  setInterim("");
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {trailing}
            <SendActionButton
              busy={sending || stopPending}
              canSend={
                !disabled &&
                (!running || !!onQueue) &&
                (!!(text + interim).trim() || files.length > 0)
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
        aria-label="选择附件"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {skills.error && text.startsWith("/") ? (
        <p role="alert" className="text-xs text-error mt-2">
          命令列表加载失败：{skills.error.message}
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
