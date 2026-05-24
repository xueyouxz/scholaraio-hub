import { Check } from "lucide-react";
import { buildPaperImageUrl } from "../paperUtils";
import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference;
  isSelected?: boolean;
  onClick?: () => void;
  selectionMode?: boolean;
  isChecked?: boolean;
  addedLabel?: string | null;
  failedReason?: string | null;
}

export function PaperGridCard({
  paper,
  isSelected,
  onClick,
  selectionMode,
  isChecked,
  addedLabel,
  failedReason,
}: Props) {
  const coverUrl = paper.coverImage ? buildPaperImageUrl(paper.id, paper.coverImage) : null;
  const borderClass = failedReason
    ? "bg-surface-container-low border-error/40 ring-1 ring-error/20"
    : selectionMode && isChecked
      ? "bg-primary-container/20 border-primary/40 ring-1 ring-primary/30"
      : isSelected
        ? "bg-surface-container-high border-primary/30 ring-1 ring-primary/20 shadow-md"
        : "bg-surface-container-low border-outline-variant/20 hover:border-outline-variant/40 hover:shadow-md";

  return (
    <button
      type="button"
      onClick={onClick}
      title={failedReason ?? undefined}
      className={`relative w-full text-left transition-all rounded-xl cursor-pointer border overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${borderClass}`}
    >
      {selectionMode ? (
        <div
          className={`absolute top-3 left-3 z-10 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            isChecked
              ? "bg-primary border-primary text-on-primary"
              : "bg-surface-container-lowest border-outline-variant/50"
          }`}
        >
          {isChecked ? <Check className="w-3 h-3" strokeWidth={3} /> : null}
        </div>
      ) : null}

      {addedLabel ? (
        <span className="absolute top-3 right-3 z-10 text-[10px] font-mono font-bold bg-primary/15 text-primary px-2 py-0.5 rounded leading-none uppercase">
          ✓ {addedLabel}
        </span>
      ) : null}

      <div className="p-5">
        <h3 className="font-serif text-base font-semibold text-on-surface line-clamp-2 mb-2">
          {paper.title}
        </h3>
        <p className="text-sm text-on-surface font-medium mb-1.5 line-clamp-1">{paper.authors}</p>
        <p className="text-[11px] font-mono text-on-surface-variant/60 tracking-wide">
          {paper.source} · {paper.date ?? paper.year}
        </p>
      </div>

      {coverUrl && (
        <div className="h-36 overflow-hidden">
          <img src={coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
    </button>
  );
}
