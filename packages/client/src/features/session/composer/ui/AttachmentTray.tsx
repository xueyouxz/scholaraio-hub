import { FileText, Loader2, RotateCw, X } from "lucide-react";
import type { StagedAttachment } from "../hooks/useStagedAttachments";

/** The files a message will carry, each with its own upload state. */
export function AttachmentTray({
  items,
  disabled,
  onRemove,
  onRetry,
}: {
  items: StagedAttachment[];
  disabled?: boolean;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-4 pt-3 pb-1" aria-label="附件">
      {items.map((item) => {
        const failed = item.status === "failed";
        const uploading = item.status === "uploading";
        return (
          <li
            key={item.key}
            data-status={item.status}
            title={item.error ?? item.file.name}
            className={`relative inline-flex items-center gap-1.5 max-w-[200px] pl-1 pr-2 py-1 bg-surface-container border rounded-lg text-xs overflow-hidden ${
              failed
                ? "border-error/40 text-error"
                : "border-outline-variant/20 text-on-surface-variant"
            }`}
          >
            {item.preview ? (
              <img src={item.preview} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
            ) : (
              <FileText size={14} aria-hidden="true" className="shrink-0 ml-1" />
            )}
            <span className="truncate">{item.file.name}</span>
            {uploading ? (
              <Loader2 size={11} aria-label="上传中" className="animate-spin shrink-0" />
            ) : null}
            {failed ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRetry(item.key)}
                aria-label={`重试上传 ${item.file.name}`}
                className="shrink-0 hover:text-on-surface transition-colors"
              >
                <RotateCw size={11} />
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(item.key)}
              aria-label={`移除 ${item.file.name}`}
              className="text-on-surface-variant hover:text-error transition-colors shrink-0"
            >
              <X size={11} />
            </button>
            {uploading ? (
              <span
                aria-hidden="true"
                className="absolute left-0 bottom-0 h-0.5 bg-primary transition-[width]"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
