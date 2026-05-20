import { BookmarkPlus, User } from "lucide-react";
import type { PaperReference } from "../../library/types";

interface Props {
  paper: PaperReference;
  onClick: () => void;
  isSelected?: boolean;
}

export function SearchResultCard({ paper, onClick, isSelected }: Props) {
  return (
    <article
      onClick={onClick}
      className={`rounded-xl p-5 transition-all duration-200 cursor-pointer group border ${
        isSelected
          ? "bg-primary/5 border-primary/20 shadow-sm"
          : "bg-surface-container-lowest border-outline-variant/10 hover:border-primary/10 hover:shadow-[0_4px_16px_rgba(23,29,26,0.06)]"
      }`}
    >
      <div className="flex justify-between items-start gap-3 mb-2.5">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] font-mono text-on-surface-variant/60 truncate">
            {paper.source}
          </span>
          <h4
            className={`font-serif text-base font-bold leading-snug line-clamp-2 transition-colors ${
              isSelected ? "text-primary" : "text-on-surface group-hover:text-primary"
            }`}
          >
            {paper.title}
          </h4>
        </div>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container shrink-0 transition-colors mt-0.5"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[26ch]">{paper.authors}</span>
        </span>
        {paper.year ? <span className="font-mono">{paper.year}</span> : null}
        {paper.citations && paper.citations !== "0" ? (
          <span className="font-mono">{paper.citations} citations</span>
        ) : null}
      </div>

      {paper.abstract ? (
        <p className="text-xs text-on-surface-variant leading-5 line-clamp-2">{paper.abstract}</p>
      ) : null}
    </article>
  );
}
