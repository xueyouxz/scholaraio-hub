import type { LucideIcon } from "lucide-react";

export type PaperStatus = "ingested" | "indexing" | "pending" | "no-pdf";
export type TopicColorMap = Map<number, string>;
export type ViewMode = "list" | "grid";

/** 阅读器中的内容标签页：概览（元数据+摘要+结论）、全文、PDF 原文。 */
export type ReadingTab = "overview" | "l4" | "pdf";

/** GET /api/papers/{id} 返回的富文本详情，仅在阅读器按需加载。 */
export interface PaperDetail {
  /** L4：全文 Markdown（paper.md）。 */
  content?: string;
  /** L3：结论段落（需先运行 scholaraio enrich-l3）。 */
  l3Conclusion?: string;
}

export interface PaperReference {
  id: string;
  title: string;
  authors: string;
  source: string;
  year: number;
  date?: string;
  citations: string;
  status: PaperStatus;
  /** paper.md 是否存在（已处理）。对应 L4 全文可读性。 */
  hasPdf?: boolean;
  /** paper.pdf 是否存在。对应 PDF 查看器可用性。 */
  hasPdfFile?: boolean;
  isIndexed?: boolean;
  abstract?: string;
  coverImage?: string | null;
  paperType?: string;
}

export interface StatCardReference {
  label: string;
  value: string;
  badge: string;
  icon: LucideIcon;
  tone: "primary" | "secondary" | "tertiary" | "error";
  miniChart?: MiniChartBar[];
}

export interface YearGroup {
  year: number;
  papers: PaperReference[];
}

export interface MiniChartBar {
  label: string;
  count: number;
  ratio: number;
}
