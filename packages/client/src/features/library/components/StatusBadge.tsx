import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import type { PaperStatus } from "../paperSummary";

const STATUSES: Record<PaperStatus, { label: string; tone: BadgeTone }> = {
  ingested: { label: "已入库", tone: "positive" },
  pending: { label: "待处理", tone: "neutral" },
  "no-pdf": { label: "缺失 PDF", tone: "failure" },
};

/** Where a paper stands in the library. */
export function StatusBadge({ status }: { status: PaperStatus }) {
  const { label, tone } = STATUSES[status];
  return <Badge tone={tone}>{label}</Badge>;
}
