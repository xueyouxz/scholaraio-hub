import type {
  ContextUsage,
  PermissionMode,
  SlashCommand,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { Paperclip } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ModelInfo, ThinkingOption } from "../../../core/types";
import { useLatestRef } from "../../../shared/lib/useLatestRef";
import type { UploadProgress } from "../composer/types";
import { useDraftPersistence } from "../hooks/useDraftPersistence";
import { useSlashCommandPicker } from "../hooks/useSlashCommandPicker";
import { MessageInputToolbar } from "./MessageInputToolbar";
import { ModelSwitcher } from "./ModelSwitcher";
import type { VoiceInputButtonRef } from "./VoiceInputButton";
import { AttachmentChips } from "./composer/AttachmentChips";
import { SendActionButton } from "./composer/SendActionButton";
import { SlashCommandBadge } from "./composer/SlashCommandBadge";
import { SlashCommandSuggestions } from "./composer/SlashCommandSuggestions";

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
  const messageRef = useLatestRef(message);
  const [interimTranscript, setInterimTranscript] = useState("");

  const slash = useSlashCommandPicker(message, slashCommands);

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

  const textareaValue = interimTranscript
    ? `${slash.messageBody}${slash.messageBody.trimEnd() && !slash.messageBody.endsWith(" ") ? " " : ""}${interimTranscript}`
    : slash.messageBody;

  const selectSlashCommand = useCallback(
    (command: SlashCommand) => {
      onMessageChange(`/${command.name} `);
      slash.dismiss();
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [onMessageChange, slash.dismiss],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && slash.showList) {
      slash.dismiss();
      return;
    }
    if (slash.showList && slash.filter) {
      const filter = slash.filter;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slash.setActiveIndex((current) => (current + 1) % filter.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slash.setActiveIndex((current) => (current - 1 + filter.length) % filter.length);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        slash.setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        slash.setActiveIndex(filter.length - 1);
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const command = filter[slash.activeIndex] ?? filter[0];
        if (command) {
          selectSlashCommand(command);
        }
        return;
      }
    }
    if (slash.showBadge && event.key === "Backspace" && slash.messageBody.length === 0) {
      event.preventDefault();
      onMessageChange("");
      slash.resume();
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
  }, [messageRef]);

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

  return (
    <div className="relative w-full">
      {slash.showList && slash.filter ? (
        <SlashCommandSuggestions
          commands={slash.filter}
          activeIndex={slash.activeIndex}
          onHover={(index) => slash.setActiveIndex(index)}
          onSelect={selectSlashCommand}
        />
      ) : null}

      <div
        className={`bg-surface-container-low border border-outline-variant/20 rounded-xl transition-all focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 ${interimTranscript ? "ring-1 ring-error/30 border-error/30" : ""}`}
      >
        <AttachmentChips
          attachments={attachments}
          uploadProgress={uploadProgress}
          onRemove={onRemoveAttachment}
        />

        {slash.showBadge && slash.selectedCommand ? (
          <SlashCommandBadge token={slash.selectedToken} command={slash.selectedCommand} />
        ) : null}

        <textarea
          ref={textareaRef}
          value={textareaValue}
          onChange={(event) => {
            setInterimTranscript("");
            slash.resume();
            const nextValue = event.target.value;
            onMessageChange(
              slash.showBadge
                ? `${slash.selectedToken}${nextValue ? ` ${nextValue}` : " "}`
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

        <div className="flex items-center justify-between px-3 pb-3 gap-2">
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

          <div className="flex items-center gap-2 shrink-0">
            {models && models.length > 0 && onModelChange ? (
              <ModelSwitcher model={model} models={models} onModelChange={onModelChange} />
            ) : null}

            <SendActionButton
              busy={busy}
              canSend={canSend}
              isRunning={Boolean(isRunning)}
              isThinking={Boolean(isThinking)}
              hasQueueAction={Boolean(onQueue)}
              hasStopAction={Boolean(onStop)}
              onSend={() => void handleSubmit(onSend)}
              onQueue={onQueue ? () => void handleSubmit(onQueue) : undefined}
              onStop={onStop}
            />
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
