import { ExternalLink } from "lucide-react";
import type React from "react";
import type { PaperReference } from "../types/ui";
import StatusBadge from "./StatusBadge";

interface PaperGridCardProps {
  paper: PaperReference;
}

const PaperGridCard: React.FC<PaperGridCardProps> = ({ paper }) => (
  <article className="bg-surface-container-low border border-outline-variant/10 rounded-xl p-5 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between gap-3 mb-3">
      <h3 className="font-serif text-base font-semibold text-on-surface line-clamp-2">
        {paper.title}
      </h3>
      <button className="p-1.5 rounded-full hover:bg-surface-container">
        <ExternalLink className="w-4 h-4 text-on-surface-variant" />
      </button>
    </div>
    <p className="text-xs text-on-surface-variant mb-3 line-clamp-1">{paper.authors}</p>
    <p className="text-xs text-on-surface-variant mb-4">
      {paper.source} • {paper.year} • {paper.citations} citations
    </p>
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={paper.status} />
      {paper.hasPdf ? (
        <span className="text-[10px] font-mono font-bold text-secondary bg-secondary-container/30 px-2 py-0.5 rounded leading-none uppercase">
          PDF
        </span>
      ) : null}
      {paper.isIndexed ? (
        <span className="text-[10px] font-mono font-bold text-primary bg-primary-container/10 px-2 py-0.5 rounded leading-none uppercase">
          Indexed
        </span>
      ) : null}
    </div>
  </article>
);

export default PaperGridCard;
