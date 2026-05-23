import type {
  ContextUsage,
  PermissionMode,
  SlashCommand,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { ArrowUp, ListPlus, Loader2, Paperclip, Square, X } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModelInfo, ThinkingOption } from "../../../core/types";
import type { UploadProgress } from "../composer/types";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import { MessageInputToolbar } from "./MessageInputToolbar";
import { ModelSwitcher } from "./ModelSwitcher";
import type { VoiceInputButtonRef } from "./VoiceInputButton";

interface MessageInputProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  attachments?: UploadedFile[];
  uploadProgress?: UploadProgress[];
  model?: string;
  models?: ModelInfo[];
  permissionMode?: PermissionMode;
  isHeld?: boolean;
  draftKey?: string;
  slashCommands?: SlashCommand[];
  supportsPermissionMode?: boolean;
  supportsThinkingToggle?: boolean;
  contextUsage?: ContextUsage;
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onModelChange?: (model: string) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onHoldChange?: (held: boolean) => void;
  onSend: (message: string) => Promise<void>;
  onQueue?: (message: string) => Promise<void>;
  onStop?: () => void;
  isRunning?: boolean;
  isThinking?: boolean;
  placeholder?: string;
}

export function MessageInput({
  message,
  thinking,
  busy,
  attachments = [],
  uploadProgress = [],
  model,
  models,
  permissionMode = "default",
  isHeld,
  draftKey,
  slashCommands,
  supportsPermissionMode = true,
  supportsThinkingToggle = true,
  contextUsage,
  onMessageChange,
  onThinkingChange,
  onAttachFiles,
  onRemoveAttachment,
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
  const voiceButtonRef = useRef<VoiceInputButtonRef | null>(null);
  const slashOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const messageRef = useRef(message);
  messageRef.current = message;
  const [slashSuggestionsDismissed, setSlashSuggestionsDismissed] = useState(false);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");

  useDraftPersistence({
    draftKey: draftKey ?? "",
    value: message,
    onLoad: onMessageChange,
  });

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  const slashFilter = useMemo(() => {
    if (!message.startsWith("/")) return null;
    const query = message.slice(1);
    if (/\s/.test(query)) return null;
    const normalizedQuery = query.toLowerCase();
    if (!slashCommands || slashCommands.length === 0) return null;
    return slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(normalizedQuery));
  }, [message, slashCommands]);

  const showSlashList = Boolean(
    !slashSuggestionsDismissed && slashFilter && slashFilter.length > 0 && message.startsWith("/"),
  );
  const slashFilterSignature = slashFilter?.map((cmd) => cmd.name).join("\n") ?? "";

  const selectedSlashCommand = useMemo(() => {
    if (!slashCommands || slashCommands.length === 0) return null;
    return (
      [...slashCommands]
        .sort((a, b) => b.name.length - a.name.length)
        .find((cmd) => message === `/${cmd.name}` || message.startsWith(`/${cmd.name} `)) ?? null
    );
  }, [message, slashCommands]);
  const selectedSlashToken = selectedSlashCommand ? `/${selectedSlashCommand.name}` : "";
  const showSlashBadge = Boolean(
    selectedSlashCommand &&
      (message.startsWith(`${selectedSlashToken} `) ||
        (slashSuggestionsDismissed && message === selectedSlashToken)),
  );
  const messageBody = showSlashBadge
    ? message.slice(selectedSlashToken.length).replace(/^ /, "")
    : message;
  const textareaValue = interimTranscript
    ? `${messageBody}${messageBody.trimEnd() && !messageBody.endsWith(" ") ? " " : ""}${interimTranscript}`
    : messageBody;

  const selectSlashCommand = useCallback(
    (command: SlashCommand) => {
      onMessageChange(`/${command.name} `);
      setSlashSuggestionsDismissed(true);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [onMessageChange],
  );

  useEffect(() => {
    if (!slashFilterSignature) {
      slashOptionRefs.current = [];
      return;
    }
    setActiveSlashIndex(0);
    slashOptionRefs.current = [];
  }, [slashFilterSignature]);

  useEffect(() => {
    if (!showSlashList) return;
    slashOptionRefs.current[activeSlashIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeSlashIndex, showSlashList]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && showSlashList) {
      setSlashSuggestionsDismissed(true);
      return;
    }
    if (showSlashList && slashFilter) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSlashIndex((current) => (current + 1) % slashFilter.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSlashIndex((current) => (current - 1 + slashFilter.length) % slashFilter.length);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveSlashIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveSlashIndex(slashFilter.length - 1);
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const command = slashFilter[activeSlashIndex] ?? slashFilter[0];
        if (command) {
          selectSlashCommand(command);
        }
        return;
      }
    }
    if (showSlashBadge && event.key === "Backspace" && messageBody.length === 0) {
      event.preventDefault();
      onMessageChange("");
      setSlashSuggestionsDismissed(false);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.nativeEvent.isComposing) {
      if (event.key === "Enter" && event.ctrlKey && !event.shiftKey && onQueue) {
        event.preventDefault();
        void handleSubmit(onQueue);
      }
      return;
    }
    event.preventDefault();
    void handleSubmit(onSend);
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
    onAttachFiles?.(pastedFiles);
  };

  const finalizeMessage = useCallback(() => {
    const pendingVoice = voiceButtonRef.current?.stopAndFinalize() ?? "";
    const trimmedMessage = messageRef.current.trimEnd();
    const finalMessage = pendingVoice
      ? trimmedMessage
        ? `${trimmedMessage} ${pendingVoice}`
        : pendingVoice
      : trimmedMessage;
    setInterimTranscript("");
    return finalMessage.trim();
  }, []);

  const handleSubmit = useCallback(
    async (submit: (message: string) => Promise<void>) => {
      const finalMessage = finalizeMessage();
      if (!finalMessage && attachments.length === 0 && uploadProgress.length === 0) return;
      await submit(finalMessage);
      textareaRef.current?.focus();
    },
    [attachments.length, finalizeMessage, uploadProgress.length],
  );

  const canSend = Boolean(message.trim() || attachments.length > 0 || uploadProgress.length > 0);
  const showQueue = Boolean(onQueue && canSend && isRunning);
  // Show stop whenever a process is actively running — users must be able to interrupt
  // even while drafting the next message. When the user has input, Queue is shown as the
  // primary action and Stop appears as a secondary control.
  const showStop = Boolean(onStop && isRunning && isThinking);
  const stopAsSecondary = showStop && canSend;

  return (
    <div className="relative w-full">
      {/* Slash command suggestions */}
      {showSlashList && slashFilter ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-fit max-w-full max-h-64 overflow-y-auto border border-outline-variant/20 rounded-xl bg-surface-container-lowest shadow-lg p-1">
          {slashFilter.map((cmd, index) => (
            <button
              key={cmd.name}
              type="button"
              ref={(element) => {
                slashOptionRefs.current[index] = element;
              }}
              onMouseEnter={() => setActiveSlashIndex(index)}
              onClick={() => selectSlashCommand(cmd)}
              title={cmd.description || undefined}
              aria-selected={index === activeSlashIndex}
              className={`w-full min-w-max text-left flex items-center px-3 py-2 rounded-lg transition-colors ${
                index === activeSlashIndex ? "bg-surface-container" : "bg-transparent"
              }`}
            >
              <span className="font-mono text-[11px] text-primary font-bold whitespace-nowrap">
                /{cmd.name}
                {cmd.argumentHint ? ` ${cmd.argumentHint}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Main input card */}
      <div
        className={`bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 ${interimTranscript ? "ring-1 ring-error/30 border-error/30" : ""}`}
      >
        {/* Attachment chips */}
        {attachments.length > 0 || uploadProgress.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {attachments.map((file) => (
              <div
                key={file.id}
                className="inline-flex items-center gap-1.5 max-w-[180px] px-2.5 py-1 bg-surface-container border border-outline-variant/20 rounded-lg text-xs text-on-surface-variant"
              >
                <span className="truncate" title={file.path}>
                  {file.originalName}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(file.id)}
                  aria-label={`Remove ${file.originalName}`}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {uploadProgress.map((progress) => (
              <div
                key={progress.fileId}
                className="inline-flex items-center gap-1.5 max-w-[180px] px-2.5 py-1 bg-surface-container border border-outline-variant/20 rounded-lg text-xs text-on-surface-variant"
              >
                <span className="truncate">{progress.fileName}</span>
                <span className="font-mono text-[10px]">{progress.percent}%</span>
              </div>
            ))}
          </div>
        ) : null}

        {showSlashBadge && selectedSlashCommand ? (
          <div className="px-4 pt-3">
            <div
              className="inline-flex max-w-full items-center rounded-full border border-outline-variant/20 px-2.5 py-1 font-mono text-[11px] font-bold text-primary"
              title={selectedSlashCommand.description || undefined}
            >
              <span className="truncate">{selectedSlashToken}</span>
            </div>
          </div>
        ) : null}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={textareaValue}
          onChange={(event) => {
            setInterimTranscript("");
            setSlashSuggestionsDismissed(false);
            const nextValue = event.target.value;
            onMessageChange(
              showSlashBadge
                ? `${selectedSlashToken}${nextValue ? ` ${nextValue}` : " "}`
                : nextValue,
            );
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
              disabled={busy || !onAttachFiles}
              title="Attach files"
              className="relative p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              <Paperclip size={15} aria-hidden="true" />
              {attachments.length > 0 || uploadProgress.length > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-primary text-on-primary text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {attachments.length + uploadProgress.length}
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
              voiceButtonRef={voiceButtonRef}
              onVoiceTranscript={(delta) => {
                const current = messageRef.current.trimEnd();
                onMessageChange(current ? `${current} ${delta}` : delta);
                setInterimTranscript("");
              }}
              onInterimTranscript={setInterimTranscript}
              onListeningStart={() => textareaRef.current?.focus()}
              voiceDisabled={busy}
              contextUsage={contextUsage}
              supportsPermissionMode={supportsPermissionMode && Boolean(onPermissionModeChange)}
              supportsThinkingToggle={supportsThinkingToggle}
            />
          </div>

          {/* Right: model selector + queue + send/stop */}
          <div className="flex items-center gap-2 shrink-0">
            {models && models.length > 0 && onModelChange ? (
              <ModelSwitcher model={model} models={models} onModelChange={onModelChange} />
            ) : null}

            {stopAsSecondary ? (
              <button
                type="button"
                onClick={() => onStop?.()}
                title="Stop"
                aria-label="Stop"
                className="p-1.5 rounded-lg bg-surface-container text-error hover:bg-error/10 transition-colors"
              >
                <Square size={11} aria-hidden="true" />
              </button>
            ) : null}

            {showQueue ? (
              <button
                type="button"
                onClick={() => onQueue && void handleSubmit(onQueue)}
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
                if (showStop && !canSend) {
                  onStop?.();
                  return;
                }
                void handleSubmit(onSend);
              }}
              disabled={busy || (!canSend && !showStop)}
              aria-label={showStop && !canSend ? "Stop" : busy ? "Sending…" : "Send"}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all disabled:opacity-40 ${
                showStop && !canSend
                  ? "bg-error text-on-error"
                  : "signature-gradient text-on-primary shadow-sm"
              }`}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : showStop && !canSend ? (
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
        onChange={(event) => {
          const selectedFiles = Array.from(event.target.files ?? []);
          if (selectedFiles.length > 0) {
            onAttachFiles?.(selectedFiles);
            event.target.value = "";
          }
        }}
      />
    </div>
  );
}
