import { BookmarkPlus, User } from "lucide-react";
import type { PaperReference } from "../../library/types";

export function SearchResultCard({ paper }: { paper: PaperReference }) {
  return (
    <article className="bg-surface-container-lowest rounded-xl p-6 transition-all duration-300 hover:shadow-[0_8px_24px_rgba(23,29,26,0.08)] group border border-transparent hover:border-primary/5">
      <div className="flex justify-between items-start gap-4 mb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3 mb-1">
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-widest ${
                paper.status === "ingested"
                  ? "bg-secondary-container text-on-secondary-container"
                  : "bg-surface-container-high text-outline"
              }`}
            >
              {paper.status === "ingested" ? "已入库" : "新发现"}
            </span>
            <span className="text-xs font-mono text-outline">{paper.source}</span>
          </div>
          <h4 className="font-serif text-xl font-bold text-on-surface leading-tight group-hover:text-primary transition-colors">
            {paper.title}
          </h4>
        </div>
        <button
          type="button"
          className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container shrink-0 transition-colors"
        >
          <BookmarkPlus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" />
          {paper.authors}
        </span>
        {paper.year ? <span>{paper.year}</span> : null}
        {paper.citations ? <span>{paper.citations} citations</span> : null}
      </div>

      {paper.abstract ? (
        <p className="text-sm text-on-surface-variant leading-7">{paper.abstract}</p>
      ) : null}
    </article>
  );
}
