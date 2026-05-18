import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import { ArrowUp, ListPlus, Loader2, Paperclip, Square, X } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModelInfo, ThinkingOption } from "../../../core/types";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { MessageInputToolbar } from "./MessageInputToolbar";

interface SlashCommand {
  name: string;
  description?: string;
}

interface MessageInputProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  files: File[];
  model?: string;
  models?: ModelInfo[];
  permissionMode?: PermissionMode;
  isHeld?: boolean;
  draftKey?: string;
  slashCommands?: SlashCommand[];
  supportsPermissionMode?: boolean;
  contextUsage?: ContextUsage;
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onFilesChange: (files: File[]) => void;
  onModelChange?: (model: string) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onHoldChange?: (held: boolean) => void;
  onSend: () => Promise<void>;
  onQueue?: () => Promise<void>;
  onStop?: () => void;
  isRunning?: boolean;
  isThinking?: boolean;
  placeholder?: string;
}

export function MessageInput({
  message,
  thinking,
  busy,
  files,
  model,
  models,
  permissionMode = "default",
  isHeld,
  draftKey,
  slashCommands,
  supportsPermissionMode = true,
  contextUsage,
  onMessageChange,
  onThinkingChange,
  onFilesChange,
  onModelChange,
  onPermissionModeChange,
  onHoldChange,
  onSend,
  onQueue,
  onStop,
  isRunning,
  isThinking,
  placeholder = "您想更改或创建什么内容？",
}: MessageInputProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageRef = useRef(message);
  messageRef.current = message;
  const [showSlashSuggestions, setShowSlashSuggestions] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  useDraftPersistence({
    draftKey: draftKey ?? "",
    value: message,
    onLoad: onMessageChange,
  });

  const speech = useSpeechRecognition({
    onFinalTranscript: (delta) => {
      const current = messageRef.current.trimEnd();
      const next = current ? `${current} ${delta}` : delta;
      onMessageChange(next);
    },
    onInterimTranscript: setInterimTranscript,
  });

  const displayValue = interimTranscript
    ? `${message}${message.trimEnd() && !message.endsWith(" ") ? " " : ""}${interimTranscript}`
    : message;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  const slashFilter = useMemo(() => {
    if (!message.startsWith("/")) return null;
    const query = message.slice(1).trim().toLowerCase();
    if (!slashCommands || slashCommands.length === 0) return null;
    return slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(query)).slice(0, 6);
  }, [message, slashCommands]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && showSlashSuggestions) {
      setShowSlashSuggestions(false);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.nativeEvent.isComposing) {
      if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && onQueue) {
        event.preventDefault();
        void onQueue();
      }
      return;
    }
    event.preventDefault();
    void onSend();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) pastedFiles.push(file);
    }
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    onFilesChange([...files, ...pastedFiles]);
  };

  const canSend = Boolean(message.trim() || files.length > 0);
  const showSlashList = Boolean(slashFilter && slashFilter.length > 0 && message.startsWith("/"));
  const showQueue = Boolean(onQueue && canSend && isRunning);
  const showStop = Boolean(onStop && isRunning && isThinking && !canSend);

  const activeModelName =
    models?.find((m) => m.id === model)?.name ?? model ?? models?.[0]?.name ?? "";

  return (
    <div className="relative w-full">
      {/* Slash command suggestions */}
      {showSlashList && slashFilter ? (
        <div className="mb-2 border border-outline-variant/20 rounded-xl bg-surface-container-lowest shadow-lg overflow-hidden">
          {slashFilter.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => onMessageChange(`/${cmd.name} `)}
              className="w-full text-left flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors"
            >
              <span className="font-mono text-[11px] text-primary font-bold">/{cmd.name}</span>
              {cmd.description ? (
                <span className="text-xs text-on-surface-variant truncate">{cmd.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Main input card */}
      <div
        className={`bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 ${interimTranscript ? "ring-1 ring-error/30 border-error/30" : ""}`}
      >
        {/* Attachment chips */}
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="inline-flex items-center gap-1.5 max-w-[180px] px-2.5 py-1 bg-surface-container border border-outline-variant/20 rounded-lg text-xs text-on-surface-variant"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={displayValue}
          onChange={(event) => {
            setInterimTranscript("");
            onMessageChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={2}
          disabled={busy}
          className="block w-full bg-transparent text-sm text-on-surface px-4 pt-3 pb-2 resize-none outline-none border-none placeholder:text-on-surface-variant/50 min-h-[60px] max-h-[45vh] leading-relaxed"
          style={{ height: "60px" }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          {/* Left: attach + toolbar controls */}
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Attach files"
              className="relative p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              <Paperclip size={15} aria-hidden="true" />
              {files.length > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-primary text-on-primary text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {files.length}
                </span>
              ) : null}
            </button>

            <MessageInputToolbar
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange ?? (() => {})}
              thinking={thinking}
              onThinkingChange={onThinkingChange}
              isHeld={isHeld}
              onHoldChange={onHoldChange}
              voiceListening={speech.listening}
              voiceSupported={speech.supported}
              onToggleVoice={() => (speech.listening ? speech.stop() : speech.start())}
              contextUsage={contextUsage}
              supportsPermissionMode={supportsPermissionMode && Boolean(onPermissionModeChange)}
            />
          </div>

          {/* Right: model selector + queue + send/stop */}
          <div className="flex items-center gap-2 shrink-0">
            {models && models.length > 0 && onModelChange ? (
              <div className="relative inline-flex">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] font-medium text-on-surface-variant px-2 py-1 rounded-lg hover:bg-surface-container hover:text-on-surface transition-colors whitespace-nowrap"
                  tabIndex={-1}
                >
                  {activeModelName}
                </button>
                <select
                  value={model ?? models[0]?.id}
                  onChange={(event) => onModelChange(event.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  aria-label="Select model"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {showQueue ? (
              <button
                type="button"
                onClick={() => void onQueue?.()}
                disabled={busy}
                title="Queue message"
                aria-label="Queue message"
                className="p-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
              >
                <ListPlus size={15} aria-hidden="true" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                if (showStop) {
                  onStop?.();
                  return;
                }
                void onSend();
              }}
              disabled={busy || (!canSend && !showStop)}
              aria-label={showStop ? "Stop" : busy ? "Sending…" : "Send"}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all disabled:opacity-40 ${
                showStop ? "bg-error text-on-error" : "signature-gradient text-on-primary shadow-sm"
              }`}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : showStop ? (
                <Square size={11} aria-hidden="true" />
              ) : (
                <ArrowUp size={15} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
      />
    </div>
  );
}
