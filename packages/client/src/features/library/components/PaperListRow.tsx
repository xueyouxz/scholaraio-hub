import { Check } from "lucide-react";
import { Badge } from "../../../shared/ui/Badge";
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

const STATUS_COLORS: Record<string, string> = {
  ingested: "bg-primary/20 text-primary",
  pending: "bg-tertiary/20 text-tertiary",
  "no-pdf": "bg-error/20 text-error",
};

export function PaperListRow({
  paper,
  isSelected,
  onClick,
  selectionMode,
  isChecked,
  addedLabel,
}: Props) {
  const initial = (paper.title || "?")[0]?.toUpperCase() ?? "?";
  const avatarColor = STATUS_COLORS[paper.status] ?? "bg-surface-container text-on-surface-variant";
  const coverUrl = paper.coverImage ? paperAssetUrl(paper.id, paper.coverImage) : null;
  const stateClass =
    selectionMode && isChecked
      ? "bg-primary-container/20 border-primary/40 ring-1 ring-primary/30"
      : isSelected
        ? "bg-surface-container-high border-outline-variant/20 ring-1 ring-primary/20"
        : "bg-surface-container-low border-transparent hover:bg-surface-container-high";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full text-left flex items-stretch rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 overflow-hidden ${stateClass}`}
      style={{ height: 152 }}
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
        <Badge tone="positive" className="absolute top-3 right-3 z-10">
          ✓ {addedLabel}
        </Badge>
      ) : null}
      {/* Cover */}
      <div className="w-36 h-full shrink-0 overflow-hidden bg-surface-container">
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center text-2xl font-serif font-bold select-none ${avatarColor}`}
          >
            {initial}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-between">
        <div className="min-w-0">
          <h3 className="font-serif text-sm font-semibold text-on-surface line-clamp-2 leading-snug">
            {paper.title}
          </h3>
          {paper.authors ? (
            <p className="mt-1 text-xs text-on-surface-variant truncate">{paper.authors}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {paper.source ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant leading-none">
                {paper.source}
              </span>
            ) : null}
            {paper.year ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant leading-none">
                {paper.year}
              </span>
            ) : null}
          </div>
        </div>

        {/* Hover actions */}
        <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {paper.abstract ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary leading-none">
              摘要
            </span>
          ) : null}
          {paper.hasFullText ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-secondary/10 text-secondary leading-none">
              全文
            </span>
          ) : null}
          {paper.hasPdf ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary leading-none">
              PDF
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
