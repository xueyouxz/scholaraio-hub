import { BookOpen, Database, FolderKanban, Library } from "lucide-react";
import type { PaperReference, StatCardReference, YearGroup } from "./types";

export const papers: PaperReference[] = [
  {
    id: "p1",
    title: "基于语义检索的学术知识编排界面设计",
    authors: "Lin, Zhao, Chen",
    source: "CHI",
    year: 2026,
    date: "2026-02-14",
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
    date: "2025-11-02",
    citations: "86",
    status: "ingested",
    hasPdf: true,
    isIndexed: true,
    abstract: "提出四层阅读模式，帮助用户在摘要、精读与全文之间切换。",
  },
  {
    id: "p3",
    title: "科研工作区中的任务流与上下文保存机制",
    authors: "Wang, Rivera",
    source: "arXiv",
    year: 2025,
    date: "2025-08-20",
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
    date: "2024-10-09",
    citations: "203",
    status: "pending",
    hasPdf: false,
    isIndexed: false,
    abstract: "以信息密度和浏览负荷为切入点，讨论论文列表与网格卡片的分层表达。",
  },
];

export const libraryYearGroups: YearGroup[] = [
  { year: 2026, papers: papers.slice(0, 1) },
  { year: 2025, papers: papers.slice(1, 3) },
  { year: 2024, papers: papers.slice(3) },
];

export const libraryStats: StatCardReference[] = [
  { label: "总论文数", value: "12,480", badge: "LIVE", icon: Library, tone: "primary" },
  { label: "缺失 PDF", value: "312", badge: "ALERT", icon: BookOpen, tone: "error" },
  { label: "待入库", value: "98", badge: "SYNC", icon: FolderKanban, tone: "tertiary" },
  { label: "未索引", value: "425", badge: "WARN", icon: Database, tone: "secondary" },
];

export const libraryFilterTags = ["CHI", "UIST", "arXiv", "CSCW"];

export const sortOptions = ["年份（最新）", "引用量（高→低）", "标题"];
