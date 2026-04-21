import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import { ArrowUp, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  placeholder?: string;
}

export function MessageInput({
  message,
  busy,
  files,
  model,
  models,
  permissionMode = "default",
  draftKey,
  slashCommands,
  supportsPermissionMode = true,
  contextUsage,
  onMessageChange,
  onFilesChange,
  onModelChange,
  onPermissionModeChange,
  onSend,
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
      return;
    }
    event.preventDefault();
    void onSend();
  };

  const canSend = Boolean(message.trim() || files.length > 0);
  const showSlashList = Boolean(slashFilter && slashFilter.length > 0 && message.startsWith("/"));

  return (
    <div className="w-full max-w-[44rem] mx-auto">
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-2.5">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 bg-surface-container-high border border-outline-variant/20 px-3 py-1 rounded-lg text-on-surface-variant"
            >
              <span className="text-[11px] font-medium font-mono max-w-44 truncate">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
                className="!border-0 !bg-transparent !p-0 hover:![transform:none] cursor-pointer text-on-surface-variant/60 hover:text-error leading-none flex items-center"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {showSlashList && slashFilter ? (
        <div className="mb-2 rounded-xl border border-outline-variant/30 bg-surface-container-low overflow-hidden shadow-md">
          {slashFilter.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              onClick={() => onMessageChange(`/${cmd.name} `)}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-container flex items-center gap-2 !border-0 !bg-transparent cursor-pointer"
            >
              <span className="text-xs font-mono text-primary">/{cmd.name}</span>
              {cmd.description ? (
                <span className="text-[11px] text-on-surface-variant truncate">
                  {cmd.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="bg-surface-container pt-0 px-0 pb-2.5 rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.10),0_1px_6px_rgba(0,0,0,0.06)] border-[3px] border-outline/50 flex flex-col gap-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={displayValue}
          onChange={(event) => {
            setInterimTranscript("");
            onMessageChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={busy}
          style={{ height: "56px" }}
          className="w-full !bg-surface-container !px-4 !pt-3 !pb-0 font-sans text-sm !min-h-[56px] max-h-[45vh] overflow-y-auto !resize-none text-on-surface placeholder:text-on-surface-variant/50 outline-none !border-0 !rounded-none leading-normal"
        />

        <div className="flex items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Attach files"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant hover:bg-surface-container-high !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors relative"
            >
              <Plus className="w-[18px] h-[18px]" />
              {files.length > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono leading-none bg-primary text-on-primary rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {files.length}
                </span>
              ) : null}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <MessageInputToolbar
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange ?? (() => {})}
              voiceListening={speech.listening}
              voiceSupported={speech.supported}
              onToggleVoice={() => (speech.listening ? speech.stop() : speech.start())}
              contextUsage={contextUsage}
              supportsPermissionMode={supportsPermissionMode && Boolean(onPermissionModeChange)}
            />

            {models && models.length > 0 && onModelChange ? (
              <div className="relative flex items-center gap-1 cursor-pointer">
                <span className="text-[12px] font-medium text-on-surface-variant whitespace-nowrap pointer-events-none">
                  {models.find((m) => m.id === model)?.name ?? model ?? models[0]?.name}
                </span>
                <ChevronDown className="w-3 h-3 text-on-surface-variant/60 shrink-0 pointer-events-none" />
                <select
                  value={model ?? models[0]?.id}
                  onChange={(event) => onModelChange(event.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full !border-0 !bg-transparent !p-0 !rounded-none !min-h-0"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void onSend()}
              disabled={busy || !canSend}
              aria-label={busy ? "Sending…" : "Send"}
              className="flex items-center justify-center w-8 h-8 rounded-full !bg-on-surface !text-surface !border-0 !p-0 hover:![transform:none] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-opacity active:scale-95"
            >
              {busy ? (
                <Loader2 className="w-[15px] h-[15px] animate-spin" />
              ) : (
                <ArrowUp className="w-[16px] h-[16px]" />
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
