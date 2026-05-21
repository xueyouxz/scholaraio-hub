import { buildPaperImageUrl } from "../paperUtils";
import type { PaperReference } from "../types";

interface Props {
  paper: PaperReference;
  isSelected?: boolean;
  onClick?: () => void;
}

export function PaperGridCard({ paper, isSelected, onClick }: Props) {
  const coverUrl = paper.coverImage ? buildPaperImageUrl(paper.id, paper.coverImage) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left transition-all rounded-xl cursor-pointer border overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isSelected
          ? "bg-surface-container-high border-primary/30 ring-1 ring-primary/20 shadow-md"
          : "bg-surface-container-low border-outline-variant/20 hover:border-outline-variant/40 hover:shadow-md"
      }`}
    >
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
