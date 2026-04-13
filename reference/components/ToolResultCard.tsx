import { ArrowRight, ExternalLink, FileText, FolderKanban } from "lucide-react";
import type React from "react";
import type { ToolResultReference } from "../types/ui";
import SectionLabel from "./SectionLabel";
import StatusBadge from "./StatusBadge";

interface ToolResultCardProps {
  result: ToolResultReference;
}

const ToolResultCard: React.FC<ToolResultCardProps> = ({ result }) => {
  if (result.kind === "papers") {
    return (
      <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-4">
        <header className="flex items-center justify-between">
          <SectionLabel label="papers" accent="primary" />
          <span className="text-xs text-on-surface-variant">{result.papers.length} results</span>
        </header>
        <div className="space-y-3">
          {result.papers.map((paper) => (
            <article
              key={paper.id}
              className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface line-clamp-2">
                    {paper.title}
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1 line-clamp-1">
                    {paper.authors}
                  </p>
                </div>
                <button className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary flex items-center gap-1">
                  打开
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <StatusBadge status={paper.status} />
                {paper.hasPdf ? (
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-secondary-container/20 text-on-secondary-container inline-flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    PDF
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (result.kind === "topics") {
    return (
      <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-4">
        <header className="flex items-center justify-between">
          <SectionLabel label="topics" accent="primary" />
          <span className="text-xs text-on-surface-variant">{result.topics.length} results</span>
        </header>
        <div className="space-y-3">
          {result.topics.map((topic) => (
            <div
              key={topic.id}
              className="w-full text-left rounded-xl border border-outline-variant/15 bg-surface-container-high p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{topic.name}</p>
                  <p className="text-xs text-on-surface-variant mt-1">{topic.paperCount} papers</p>
                </div>
                <ArrowRight className="w-4 h-4 text-on-surface-variant" />
              </div>
              <div className="mt-3 flex gap-1.5 flex-wrap">
                {topic.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-primary/10 text-primary"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-4">
      <header className="flex items-center justify-between">
        <SectionLabel label="workspace" accent="primary" />
        <span className="text-xs text-on-surface-variant">{result.workspaceResult.operation}</span>
      </header>
      <article className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4 space-y-2">
        <div className="flex items-center gap-2">
          <FolderKanban className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-on-surface">
            {result.workspaceResult.workspace.name}
          </p>
        </div>
        <p className="text-xs text-on-surface-variant">
          Paper count: {result.workspaceResult.workspace.paperCount}
        </p>
        <p className="text-xs text-on-surface-variant">
          Created at: {result.workspaceResult.workspace.createdAt}
        </p>
      </article>
    </section>
  );
};

export default ToolResultCard;
