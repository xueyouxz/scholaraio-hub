import type { PaperStatus } from "../paperSummary";

const statusMap: Record<PaperStatus, { label: string; className: string }> = {
  ingested: { label: "已入库", className: "text-primary bg-primary-container/10" },
  pending: { label: "待处理", className: "text-on-surface-variant/70 bg-surface-container-high" },
  "no-pdf": { label: "缺失 PDF", className: "text-error bg-error-container/40" },
};

export function StatusBadge({ status }: { status: PaperStatus }) {
  const item = statusMap[status];
  return (
    <span
      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded leading-none uppercase ${item.className}`}
    >
      {item.label}
    </span>
  );
}
