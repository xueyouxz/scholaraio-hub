import { ExternalLink, MoreVertical } from "lucide-react";
import type React from "react";
import type { PaperReference } from "../types/ui";
import StatusBadge from "./StatusBadge";

interface PaperListRowProps {
  paper: PaperReference;
}

const PaperListRow: React.FC<PaperListRowProps> = ({ paper }) => (
  <article className="h-[72px] flex items-center px-6 bg-surface-container-low hover:bg-surface-container-high transition-all rounded-xl group">
    <div
      className={`w-2 h-2 rounded-full mr-6 ${
        paper.status === "ingested"
          ? "bg-primary shadow-[0_0_8px_rgba(26,107,74,0.4)]"
          : paper.status === "pending"
            ? "bg-tertiary"
            : paper.status === "indexing"
              ? "bg-secondary"
              : "bg-error"
      }`}
    />
    <div className="flex-1 min-w-0">
      <h3 className="font-serif text-base font-semibold text-on-surface truncate pr-4">
        {paper.title}
      </h3>
      <div className="flex items-center gap-4 mt-0.5 flex-wrap">
        <span className="text-xs font-sans text-on-surface-variant">
          {paper.authors} • {paper.source} • {paper.date}
        </span>
        <div className="flex gap-2">
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
      </div>
    </div>
    <div className="flex items-center gap-2 opacity-100 transition-opacity">
      <button className="p-2 hover:bg-white rounded-full text-on-surface-variant">
        <ExternalLink className="w-4 h-4" />
      </button>
      <button className="p-2 hover:bg-white rounded-full text-on-surface-variant">
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  </article>
);

export default PaperListRow;
