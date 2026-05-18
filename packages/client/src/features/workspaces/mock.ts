import type { PaperReference } from "../library/types";

export interface WorkspaceReference {
  id: string;
  name: string;
  createdAt: string;
  paperCount: number;
  papers: PaperReference[];
}

const papers: PaperReference[] = [
  {
    id: "p1",
    title: "基于语义检索的学术知识编排界面设计",
    authors: "Lin, Zhao, Chen",
    source: "CHI",
    year: 2026,
    citations: "128",
    status: "ingested",
    hasPdf: true,
    isIndexed: true,
  },
  {
    id: "p2",
    title: "Layered Reading Interfaces for Research Copilots",
    authors: "A. Singh, M. Hart",
    source: "UIST",
    year: 2025,
    citations: "86",
    status: "ingested",
    hasPdf: true,
    isIndexed: true,
  },
  {
    id: "p3",
    title: "科研工作区中的任务流与上下文保存机制",
    authors: "Wang, Rivera",
    source: "arXiv",
    year: 2025,
    citations: "34",
    status: "indexing",
    hasPdf: true,
    isIndexed: false,
  },
];

export const workspaces: WorkspaceReference[] = [
  {
    id: "w1",
    name: "AI Scholar UI Refactor",
    createdAt: "2026-04-01",
    paperCount: 3,
    papers: papers.slice(0, 3),
  },
  {
    id: "w2",
    name: "Reading Experience Audit",
    createdAt: "2026-03-22",
    paperCount: 2,
    papers: papers.slice(1, 3),
  },
];
