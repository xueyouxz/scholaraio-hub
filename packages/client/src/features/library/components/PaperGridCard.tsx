import { Check } from "lucide-react";
import { paperAssetUrl } from "../paperSummary";
import type { PaperSummary } from "../paperSummary";

interface Props {
  paper: PaperSummary;
  isSelected?: boolean;
  onClick?: () => void;
  selectionMode?: boolean;
  isChecked?: boolean;
  addedLabel?: string | null;
}

export function PaperGridCard({
  paper,
  isSelected,
  onClick,
  selectionMode,
  isChecked,
  addedLabel,
}: Props) {
  const coverUrl = paper.coverImage ? paperAssetUrl(paper.id, paper.coverImage) : null;
  const borderClass =
    selectionMode && isChecked
      ? "bg-primary-container/20 border-primary/40 ring-1 ring-primary/30"
      : isSelected
        ? "bg-surface-container-high border-primary/30 ring-1 ring-primary/20 shadow-md"
        : "bg-surface-container-low border-outline-variant/20 hover:border-outline-variant/40 hover:shadow-md";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selectionMode ? !!isChecked : !!isSelected}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 220px" }}
      className={`relative w-full text-left transition-[background-color,border-color,box-shadow] rounded-xl cursor-pointer border overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${borderClass}`}
    >
      {selectionMode ? (
        <div
          className={`absolute top-3 left-3.5 z-10 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
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

      <div className="px-3.5 py-3">
        {/* The checkbox sits on the title's first line; indent the title so it clears it. */}
        <h3
          className={`font-serif text-sm font-semibold leading-snug text-on-surface line-clamp-2 mb-1.5 ${
            selectionMode ? "pl-7" : ""
          }`}
        >
          {paper.title}
        </h3>
        <p className="text-xs text-on-surface font-medium mb-1 line-clamp-1">{paper.authors}</p>
        <p className="text-[10px] font-mono text-on-surface-variant/60 tracking-wide truncate">
          {paper.source} · {paper.year}
        </p>
      </div>

      {coverUrl && (
        <div className="h-28 overflow-hidden">
          <img
            width={400}
            height={112}
            src={coverUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}
    </button>
  );
}
