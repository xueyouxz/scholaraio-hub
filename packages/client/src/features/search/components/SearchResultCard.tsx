import { buildPaperImageUrl } from "../../library/paperUtils";
import type { PaperReference } from "../../library/types";
import { normalizePaperType } from "./DocTypeFilter";

const TYPE_BADGE = {
  期刊论文: {
    label: "JOURNAL",
    bg: "bg-primary/10",
    text: "text-primary",
  },
  会议论文: {
    label: "CONFERENCE",
    bg: "bg-secondary-container",
    text: "text-on-secondary-container",
  },
  预印本: {
    label: "PREPRINT",
    bg: "bg-tertiary-container",
    text: "text-on-tertiary-container",
  },
} as const;

interface Props {
  paper: PaperReference;
  onClick: () => void;
  isSelected?: boolean;
}

export function SearchResultCard({ paper, onClick, isSelected }: Props) {
  const docType = normalizePaperType(paper.paperType);
  const badge = docType ? TYPE_BADGE[docType] : null;
  const coverUrl = paper.coverImage ? buildPaperImageUrl(paper.id, paper.coverImage) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`block w-full text-left rounded-xl overflow-hidden transition-all duration-200 cursor-pointer border ${
        isSelected
          ? "bg-primary/5 border-primary/20 shadow-sm"
          : "bg-surface-container-lowest border-outline-variant/10 hover:border-primary/10 hover:shadow-[0_4px_16px_rgba(23,29,26,0.06)]"
      }`}
    >
      <div className="p-5 pb-4">
        {/* Badge row */}
        {badge && (
          <div className="mb-2.5">
            <span
              className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase ${badge.bg} ${badge.text}`}
            >
              {badge.label}
            </span>
          </div>
        )}

        {/* Title + bookmark */}
        <div className="flex justify-between items-start gap-3 mb-3">
          <h4
            className={`font-serif text-xl font-bold leading-snug transition-colors ${
              isSelected ? "text-primary" : "text-on-surface"
            }`}
          >
            {paper.title}
          </h4>
        </div>

        {/* Authors */}
        {paper.authors && (
          <p className="text-sm font-semibold text-on-surface mb-1.5 line-clamp-1">
            {paper.authors}
          </p>
        )}

        {/* Source · Year */}
        <p className="text-xs font-mono text-on-surface-variant/70">
          {[paper.source, paper.year || null].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* Cover image — only rendered when present */}
      {coverUrl && (
        <div className="h-40 overflow-hidden">
          <img src={coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
    </button>
  );
}
