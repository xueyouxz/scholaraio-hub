import type { LucideIcon } from "lucide-react";

export type NavItemState = "default" | "active";
export type SearchMode = "keyword" | "semantic" | "hybrid";
export type PaperStatus = "ingested" | "indexing" | "pending" | "no-pdf";
export type ViewMode = "list" | "grid";
export type ToolCallStatus = "pending" | "done" | "error";
export type ReaderLayer = "L1 摘要" | "L2 精读" | "L3 全文导读" | "L4 原始文献";

export interface NavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  state?: NavItemState;
}

export interface SessionItem {
  id: string;
  title: string;
  date: string;
  active?: boolean;
}

export interface ProfileMenuItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface AttachmentReference {
  id: string;
  name: string;
  kind: "image" | "file";
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
  hasPdf?: boolean;
  isIndexed?: boolean;
  abstract?: string;
}

export interface TopicReference {
  id: string;
  name: string;
  paperCount: number;
  keywords: string[];
}

export interface WorkspaceReference {
  id: string;
  name: string;
  createdAt: string;
  paperCount: number;
  papers: PaperReference[];
}

export interface ToolResultWorkspaceReference {
  operation: "created" | "updated" | "listed";
  workspace: WorkspaceReference;
}

export type ToolResultReference =
  | { kind: "papers"; papers: PaperReference[] }
  | { kind: "topics"; topics: TopicReference[] }
  | { kind: "workspace"; workspaceResult: ToolResultWorkspaceReference };

export interface ToolCallReference {
  toolName: string;
  status: ToolCallStatus;
}

export interface MessageReference {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AttachmentReference[];
  toolCalls?: ToolCallReference[];
  toolResults?: ToolResultReference[];
  editing?: boolean;
}

export interface StatCardReference {
  label: string;
  value: string;
  badge: string;
  icon: LucideIcon;
  tone: "primary" | "secondary" | "tertiary" | "error";
}

export interface SearchFilterGroup {
  title: string;
  options: Array<{ label: string; checked?: boolean }>;
}

export interface ReaderInsightReference {
  id: string;
  title: string;
  authors: string;
  year: number;
  citations: string;
  summary: string;
  selected?: boolean;
}

export interface SettingsFieldReference {
  label: string;
  value: string;
  envTag?: string;
}

export interface PathReference {
  label: string;
  path: string;
  source: string;
  verified?: boolean;
}
