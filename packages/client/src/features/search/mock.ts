import type { PaperReference } from "../library/types";

export interface SearchMode {
  id: string;
  label: string;
  highlight?: boolean;
}

export interface SearchFilterOption {
  label: string;
  checked: boolean;
}

export interface SearchFilterGroup {
  title: string;
  options: SearchFilterOption[];
}

export const searchModes: SearchMode[] = [
  { id: "keyword", label: "关键词" },
  { id: "semantic", label: "语义" },
  { id: "hybrid", label: "混合", highlight: true },
];

export const searchFilters: SearchFilterGroup[] = [
  {
    title: "发表类型",
    options: [
      { label: "期刊论文", checked: true },
      { label: "会议论文", checked: true },
      { label: "预印本", checked: false },
      { label: "学位论文", checked: false },
    ],
  },
  {
    title: "入库状态",
    options: [
      { label: "已在文库中", checked: true },
      { label: "尚未入库", checked: false },
    ],
  },
];

export const sortOptions = ["年份（最新）", "引用量", "标题"];

export const searchResults: PaperReference[] = [
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
    abstract: "本文讨论如何在研究型工作台中将检索、阅读、比较与写作编排为统一的认知界面。",
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
    abstract: "提出四层阅读模式，帮助用户在摘要、精读与原文之间切换。",
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
    abstract: "研究工作区中持续上下文、跨会话草稿和引用链可视化的设计模式。",
  },
  {
    id: "p4",
    title: "大型论文库中的文献筛选与卡片信息分层",
    authors: "Sun, Patel",
    source: "CSCW",
    year: 2024,
    citations: "203",
    status: "pending",
    hasPdf: false,
    isIndexed: false,
    abstract: "以信息密度和浏览负荷为切入点，讨论论文列表与网格卡片的分层表达。",
  },
];
