import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { canNavigateToReader, canReadPdf } from "../paperUtils";
import type { PaperReference } from "../types";

interface Props {
  papers: PaperReference[];
  currentPaperId: string;
  onBack: () => void;
}

export function ReaderSidebar({ papers, currentPaperId, onBack }: Props) {
  const navigate = useNavigate();

  return (
    <div className="w-[280px] shrink-0 flex flex-col h-full bg-surface-container-low border-r border-outline-variant/15 overflow-hidden">
      {/* ── Back button ── */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-outline-variant/10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors border-0 bg-transparent p-0 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回 Library
        </button>
      </div>

      {/* ── Section label ── */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            Papers
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">
            {papers.length}
          </span>
        </div>
      </div>

      {/* ── Paper list ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {papers.map((paper) => {
          const navigable = canNavigateToReader(paper);
          const hasPdf = canReadPdf(paper);
          const isActive = paper.id === currentPaperId;

          return (
            <button
              key={paper.id}
              type="button"
              disabled={!navigable}
              title={!navigable ? "此文献暂无可读内容（尚未入库）" : undefined}
              onClick={() => navigable && navigate(`/library/${paper.id}`)}
              className={[
                "w-full text-left px-4 py-3 border-b border-outline-variant/10 transition-colors border-0 bg-transparent",
                isActive
                  ? "bg-primary/10 border-l-4 border-l-primary pl-3"
                  : navigable
                    ? "hover:bg-surface-container cursor-pointer"
                    : "opacity-40 cursor-not-allowed",
              ].join(" ")}
            >
              <div className="flex items-start gap-2">
                {/* Status dot */}
                <span
                  className={[
                    "mt-1.5 w-1.5 h-1.5 rounded-full shrink-0",
                    paper.status === "ingested"
                      ? "bg-primary shadow-[0_0_6px_rgba(26,107,74,0.5)]"
                      : paper.status === "indexing"
                        ? "bg-secondary"
                        : paper.status === "pending"
                          ? "bg-tertiary"
                          : "bg-error",
                  ].join(" ")}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-xs font-semibold text-on-surface leading-snug line-clamp-2">
                    {paper.title}
                  </p>
                  {paper.authors ? (
                    <p className="text-[10px] font-mono text-on-surface-variant mt-0.5 truncate">
                      {paper.authors}
                    </p>
                  ) : null}
                  {/* No-PDF badge */}
                  {navigable && !hasPdf ? (
                    <span className="mt-1 inline-block text-[9px] font-mono font-bold text-error bg-error-container/40 px-1.5 py-0.5 rounded leading-none uppercase">
                      无 PDF
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
