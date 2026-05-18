import { BookOpen, Calendar, FileText, Hash, Library, Link, Users } from "lucide-react";
import type { PaperDetail, PaperReference, ReadingTab } from "../types";

interface Props {
  paper: PaperReference;
  activeLayer: Exclude<ReadingTab, "pdf">;
  detail: PaperDetail | null;
  loadingDetail: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <span className="text-xs font-mono text-on-surface-variant animate-pulse">加载中…</span>
    </div>
  );
}

// ─── Layer panels ─────────────────────────────────────────────────────────────

function L1Panel({ paper }: { paper: PaperReference }) {
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="font-serif text-xl font-bold text-on-surface leading-snug">{paper.title}</h1>

      <div className="h-px bg-outline-variant/10" />

      <div className="space-y-4">
        <MetaRow icon={Users} label="Authors" value={paper.authors} />
        <MetaRow icon={Calendar} label="Year" value={paper.year ? String(paper.year) : undefined} />
        <MetaRow icon={Library} label="Source" value={paper.source} />
        <MetaRow icon={Hash} label="Citations" value={paper.citations} />
        <MetaRow icon={Link} label="DOI" value={(paper as PaperReference & { doi?: string }).doi} />
      </div>

      <div className="h-px bg-outline-variant/10" />

      <div className="flex flex-wrap gap-2">
        {/* Status badge */}
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
    </div>
  );
}

function L2Panel({ paper }: { paper: PaperReference }) {
  if (!paper.abstract) {
    return <EmptyState message="暂无摘要" sub="此文献的元数据中未包含摘要信息" />;
  }
  return (
    <div className="max-w-2xl">
      <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-4">
        Abstract
      </p>
      <p className="text-sm text-on-surface leading-relaxed">{paper.abstract}</p>
    </div>
  );
}

function L3Panel({
  detail,
  loading,
}: {
  detail: PaperDetail | null;
  loading: boolean;
}) {
  if (loading) return <LoadingState />;
  if (!detail?.l3Conclusion) {
    return (
      <EmptyState
        message="结论尚未提取"
        sub="运行 scholaraio enrich-l3 <paper_id> 提取结论段落后即可在此查看"
      />
    );
  }
  return (
    <div className="max-w-2xl">
      <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-4">
        Conclusion
      </p>
      <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
        {detail.l3Conclusion}
      </p>
    </div>
  );
}

function L4Panel({
  detail,
  loading,
}: {
  detail: PaperDetail | null;
  loading: boolean;
}) {
  if (loading) return <LoadingState />;
  if (!detail?.content) {
    return (
      <EmptyState message="全文内容不可用" sub="此文献尚未完成 Markdown 转换（paper.md 不存在）" />
    );
  }
  return (
    <div className="max-w-3xl">
      <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-4">
        Full Text
      </p>
      <pre className="text-xs font-mono text-on-surface whitespace-pre-wrap leading-relaxed break-words">
        {detail.content}
      </pre>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LayerReader({ paper, activeLayer, detail, loadingDetail }: Props) {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-8 py-6">
      {activeLayer === "l1" && <L1Panel paper={paper} />}
      {activeLayer === "l2" && <L2Panel paper={paper} />}
      {activeLayer === "l3" && <L3Panel detail={detail} loading={loadingDetail} />}
      {activeLayer === "l4" && <L4Panel detail={detail} loading={loadingDetail} />}
    </div>
  );
}
