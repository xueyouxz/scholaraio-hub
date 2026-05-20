import { Calendar, FileText, Hash, Library, Link, Users } from "lucide-react";
import type { PaperDetail, PaperReference, ReadingTab } from "../types";
import { PaperMarkdown } from "./PaperMarkdown";

interface Props {
  paper: PaperReference;
  paperId: string;
  activeLayer: Exclude<ReadingTab, "pdf">;
  detail: PaperDetail | null;
  loadingDetail: boolean;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center mt-0.5">
        <Icon className="w-3.5 h-3.5 text-on-surface-variant" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-0.5">
          {label}
        </p>
        <p className="text-sm text-on-surface leading-relaxed break-words">{value}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-4">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="h-px bg-outline-variant/10" />;
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center mb-3">
        <FileText className="w-5 h-5 text-on-surface-variant/50" />
      </div>
      <p className="text-sm font-semibold text-on-surface mb-1">{message}</p>
      {sub ? <p className="text-xs text-on-surface-variant">{sub}</p> : null}
    </div>
  );
}

function LoadingPulse() {
  return (
    <div className="space-y-2">
      <div className="h-3 bg-surface-container rounded-full w-3/4 animate-pulse" />
      <div className="h-3 bg-surface-container rounded-full w-full animate-pulse" />
      <div className="h-3 bg-surface-container rounded-full w-5/6 animate-pulse" />
    </div>
  );
}

// ─── Overview panel (L1 + L2 + L3) ───────────────────────────────────────────

function OverviewPanel({
  paper,
  detail,
  loading,
}: {
  paper: PaperReference;
  detail: PaperDetail | null;
  loading: boolean;
}) {
  const doi = (paper as PaperReference & { doi?: string }).doi;
  const hasConclusion = loading || !!detail?.l3Conclusion;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Title */}
      <h1 className="font-serif text-xl font-bold text-on-surface leading-snug">{paper.title}</h1>

      <Divider />

      {/* Metadata */}
      <div className="space-y-4">
        <MetaRow icon={Users} label="Authors" value={paper.authors} />
        <MetaRow icon={Calendar} label="Year" value={paper.year ? String(paper.year) : undefined} />
        <MetaRow icon={Library} label="Source" value={paper.source} />
        <MetaRow icon={Hash} label="Citations" value={paper.citations} />
        <MetaRow icon={Link} label="DOI" value={doi} />
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <span
          className={[
            "text-[10px] font-mono font-bold px-2 py-0.5 rounded leading-none uppercase",
            paper.status === "ingested"
              ? "text-primary bg-primary-container/10"
              : paper.status === "indexing"
                ? "text-on-surface-variant bg-surface-variant"
                : paper.status === "pending"
                  ? "text-on-surface-variant/40 bg-surface-variant/50"
                  : "text-error bg-error-container/40",
          ].join(" ")}
        >
          {paper.status}
        </span>
        {paper.hasPdf ? (
          <span className="text-[10px] font-mono font-bold text-secondary bg-secondary-container/30 px-2 py-0.5 rounded leading-none uppercase">
            Markdown
          </span>
        ) : null}
        {paper.hasPdfFile ? (
          <span className="text-[10px] font-mono font-bold text-primary bg-primary-container/10 px-2 py-0.5 rounded leading-none uppercase">
            PDF
          </span>
        ) : null}
        {paper.isIndexed ? (
          <span className="text-[10px] font-mono font-bold text-primary bg-primary-container/10 px-2 py-0.5 rounded leading-none uppercase">
            Indexed
          </span>
        ) : null}
      </div>

      {/* Abstract */}
      {paper.abstract ? (
        <>
          <Divider />
          <div>
            <SectionLabel>Abstract</SectionLabel>
            <p className="text-sm text-on-surface leading-relaxed">{paper.abstract}</p>
          </div>
        </>
      ) : null}

      {/* Conclusion — shown while loading or when content exists */}
      {hasConclusion ? (
        <>
          <Divider />
          <div>
            <SectionLabel>Conclusion</SectionLabel>
            {loading ? (
              <LoadingPulse />
            ) : (
              <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
                {detail?.l3Conclusion}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── L4 full-text panel ───────────────────────────────────────────────────────

function L4Panel({
  detail,
  loading,
  paperId,
}: {
  detail: PaperDetail | null;
  loading: boolean;
  paperId: string;
}) {
  if (loading) {
    return (
      <div className="max-w-3xl space-y-3">
        <SectionLabel>Full Text</SectionLabel>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
              key={i}
              className="h-3 bg-surface-container rounded-full animate-pulse"
              style={{ width: `${70 + (i % 3) * 10}%` }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (!detail?.content) {
    return (
      <EmptyState message="全文内容不可用" sub="此文献尚未完成 Markdown 转换（paper.md 不存在）" />
    );
  }
  return (
    <div className="max-w-3xl">
      <SectionLabel>Full Text</SectionLabel>
      <PaperMarkdown content={detail.content} paperId={paperId} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LayerReader({ paper, paperId, activeLayer, detail, loadingDetail }: Props) {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-8 py-6">
      {activeLayer === "overview" && (
        <OverviewPanel paper={paper} detail={detail} loading={loadingDetail} />
      )}
      {activeLayer === "l4" && (
        <L4Panel detail={detail} loading={loadingDetail} paperId={paperId} />
      )}
    </div>
  );
}
