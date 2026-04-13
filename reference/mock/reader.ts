import type { ReaderInsightReference } from "../types/ui";
import { papers, workspaces } from "./entities";

export const readerLayers = [
  { label: "L1 摘要", active: false },
  { label: "L2 精读", active: true },
  { label: "L3 全文导读", active: false },
  { label: "L4 原始文献", active: false },
];

export const readerInsights: ReaderInsightReference[] = [
  {
    id: "ri1",
    title: papers[1].title,
    authors: papers[1].authors,
    year: papers[1].year,
    citations: papers[1].citations,
    summary: "强调四层阅读模式如何降低长文献浏览的认知切换成本。",
    selected: true,
  },
  {
    id: "ri2",
    title: papers[2].title,
    authors: papers[2].authors,
    year: papers[2].year,
    citations: papers[2].citations,
    summary: "更关注跨会话上下文保存和工作区视图的连接方式。",
  },
  {
    id: "ri3",
    title: papers[3].title,
    authors: papers[3].authors,
    year: papers[3].year,
    citations: papers[3].citations,
    summary: "讨论论文卡片信息密度、筛选器与浏览模式切换。",
  },
];

export const selectedReaderPaper = papers[0];
export const readerWorkspaces = workspaces;
