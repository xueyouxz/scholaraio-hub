import {
  ArrowUp,
  BarChart2,
  ChevronDown,
  Loader2,
  Palette,
  Plus,
  SquarePlus,
  X,
} from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef } from "react";
import type { ModelInfo, ThinkingOption } from "../../../core/types";

interface MessageInputProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  files: File[];
  model?: string;
  models?: ModelInfo[];
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onFilesChange: (files: File[]) => void;
  onModelChange?: (model: string) => void;
  onSend: () => Promise<void>;
  placeholder?: string;
}

export function MessageInput({
  message,
  thinking,
  busy,
  files,
  model,
  models,
  onMessageChange,
  onThinkingChange,
  onFilesChange,
  onModelChange,
  onSend,
  placeholder = "您想更改或创建什么内容？",
}: MessageInputProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize: shrink to min-height first, then grow to fit content.
  // useLayoutEffect fires before the browser paints so there is no visible
  // intermediate state from the height:auto step. No dep array — runs after
  // every render so the height always reflects the current DOM scrollHeight.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void onSend();
  };

  const canSend = Boolean(message.trim() || files.length > 0);

  return (
    <div className="w-full max-w-[36rem] mx-auto">
      {/* Attachment chips */}
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

      {/* Main input box */}
      <div className="bg-surface-container pt-0 px-0 pb-2.5 rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.10),0_1px_6px_rgba(0,0,0,0.06)] border-[3px] border-outline/50 flex flex-col gap-1 overflow-hidden">
        {/* Textarea — auto-grows with content, caps at 45 vh and scrolls beyond */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={busy}
          style={{ height: "56px" }}
          className="w-full !bg-surface-container !px-4 !pt-3 !pb-0 font-sans text-sm !min-h-[56px] max-h-[45vh] overflow-y-auto !resize-none text-on-surface placeholder:text-on-surface-variant/50 outline-none !border-0 !rounded-none leading-normal"
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4">
          {/* Left actions */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              title="Add"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant hover:bg-surface-container-high !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Attach files"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant hover:bg-surface-container-high !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors relative"
            >
              <SquarePlus className="w-[18px] h-[18px]" />
              {files.length > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono leading-none bg-primary text-on-primary rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {files.length}
                </span>
              ) : null}
            </button>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled
              title="Style"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant/40 !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-not-allowed transition-colors"
            >
              <Palette className="w-[18px] h-[18px]" />
            </button>

            {/* Model selector */}
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
              disabled
              title="Intensity"
              className="flex items-center justify-center w-8 h-8 rounded-xl text-on-surface-variant/40 !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-not-allowed transition-colors"
            >
              <BarChart2 className="w-[18px] h-[18px]" />
            </button>

            {/* Send */}
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
