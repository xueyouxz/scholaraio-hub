import type { ImportJob } from "@scholaraio-hub/shared";

export type ImportItem = ImportJob["items"][number];

/** The ingest pipeline, in the order the import queue runs it. */
export const PIPELINE_STEPS = [
  { id: "mineru", label: "转换 Markdown" },
  { id: "extract", label: "提取元数据" },
  { id: "dedup", label: "查重" },
  { id: "ingest", label: "入库" },
] as const;

export const ACTIVE_IMPORT = ["queued", "running"];
export const INGESTED_IMPORT = ["completed", "completed_incomplete"];

export type ImportTone = "active" | "done" | "warning" | "error" | "muted";

/** What one import item is doing, said the same way wherever it is shown. */
export function importState(item: ImportItem): {
  label: string;
  tone: ImportTone;
  /** Index of the pipeline step reached, -1 before the first. */
  reached: number;
} {
  const reached = PIPELINE_STEPS.findIndex((step) => step.id === item.step);
  switch (item.status) {
    case "queued":
      return { label: "排队中", tone: "muted", reached: -1 };
    case "running":
      return {
        label: reached >= 0 ? `${PIPELINE_STEPS[reached]?.label}中` : "处理中",
        tone: "active",
        reached: Math.max(0, reached),
      };
    case "completed":
      return { label: "已入库", tone: "done", reached: PIPELINE_STEPS.length };
    case "completed_incomplete":
      return { label: "已入库 · 元数据不完整", tone: "warning", reached: PIPELINE_STEPS.length };
    case "duplicate":
      return { label: "已存在", tone: "done", reached: PIPELINE_STEPS.length };
    case "needs_review":
      return { label: "待确认", tone: "warning", reached: -1 };
    case "failed":
      return { label: "失败", tone: "error", reached: -1 };
    default:
      return { label: item.status, tone: "muted", reached: -1 };
  }
}

export const TONE_TEXT: Record<ImportTone, string> = {
  active: "text-primary",
  done: "text-primary",
  warning: "text-secondary",
  error: "text-error",
  muted: "text-on-surface-variant/70",
};
