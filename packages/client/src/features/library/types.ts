import type { LucideIcon } from "lucide-react";

export type PaperStatus = "ingested" | "indexing" | "pending" | "no-pdf";
export type ViewMode = "list" | "grid";

export interface PaperReference {
  id: string;
  title: string;
  authors: string;
  source: string;
  year: number;
  date?: string;
  citations: string;
  status: PaperStatus;
  hasPdf?: boolean;
  isIndexed?: boolean;
  abstract?: string;
}

export interface StatCardReference {
  label: string;
  value: string;
  badge: string;
  icon: LucideIcon;
  tone: "primary" | "secondary" | "tertiary" | "error";
}

export interface YearGroup {
  year: number;
  papers: PaperReference[];
}
