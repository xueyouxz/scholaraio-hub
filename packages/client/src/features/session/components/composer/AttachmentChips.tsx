import type { UploadedFile } from "@scholaraio-hub/shared";
import { X } from "lucide-react";
import type { UploadProgress } from "../../composer/types";

interface Props {
  attachments: UploadedFile[];
  uploadProgress: UploadProgress[];
  onRemove?: (id: string) => void;
}

export function AttachmentChips({ attachments, uploadProgress, onRemove }: Props) {
  if (attachments.length === 0 && uploadProgress.length === 0) return null;

  return (
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
            onClick={() => onRemove?.(file.id)}
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
  );
}
