import { Calendar, Hash, Library, Link, Users } from "lucide-react";
import { Badge } from "../../../shared/ui/Badge";
import { StatusBadge } from "../components/StatusBadge";
import type { PaperSummary } from "../paperSummary";

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

/** Reader overview (L1 + L2 + L3): metadata, abstract and conclusion. */
export function LayerReader({
  paper,
  conclusion,
}: {
  paper: PaperSummary;
  /** L3 conclusion (present once `scholaraio enrich-l3` has run). */
  conclusion?: string;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="max-w-2xl space-y-5">
        {/* Title */}
        <h1 className="font-serif text-xl font-bold text-on-surface leading-snug">{paper.title}</h1>

        <Divider />

        {/* Metadata */}
        <div className="space-y-4">
          <MetaRow icon={Users} label="Authors" value={paper.authors} />
          <MetaRow
            icon={Calendar}
            label="Year"
            value={paper.year ? String(paper.year) : undefined}
          />
          <MetaRow icon={Library} label="Source" value={paper.source} />
          <MetaRow icon={Hash} label="Citations" value={paper.citations} />
          <MetaRow icon={Link} label="DOI" value={paper.doi} />
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={paper.status} />
          {paper.hasFullText ? <Badge tone="kind">Markdown</Badge> : null}
          {paper.hasPdf ? <Badge tone="kind">PDF</Badge> : null}
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

        {conclusion ? (
          <>
            <Divider />
            <div>
              <SectionLabel>Conclusion</SectionLabel>
              <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
                {conclusion}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
