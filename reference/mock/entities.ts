import {
  BookOpen,
  Database,
  FolderKanban,
  HelpCircle,
  Languages,
  Library,
  Search,
  Settings,
} from "lucide-react";
import type {
  NavigationItem,
  PaperReference,
  ProfileMenuItem,
  SessionItem,
  StatCardReference,
  TopicReference,
  WorkspaceReference,
} from "../types/ui";

export const navigationItems: NavigationItem[] = [
  { id: "search", label: "检索", icon: Search },
  { id: "library", label: "文库", icon: Library },
  { id: "workspaces", label: "工作区", icon: FolderKanban },
];

export const sidebarSessions: SessionItem[] = [
  { id: "s1", title: "多模态学术助手框架拆解", date: "2026-04-09", active: true },
  { id: "s2", title: "科研知识库工作流设计", date: "2026-04-09" },
  { id: "s3", title: "检索增强综述策略", date: "2026-04-08" },
  { id: "s4", title: "论文精读界面比较", date: "2026-04-07" },
];

export const profileMenuItems: ProfileMenuItem[] = [
  {
    id: "language",
    label: "语言切换",
    description: "简体中文",
    icon: Languages,
  },
  {
    id: "settings",
    label: "系统设置",
    description: "模型与路径配置",
    icon: Settings,
  },
  {
    id: "help",
    label: "帮助中心",
    description: "文档与支持",
    icon: HelpCircle,
  },
];

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
    abstract: "提出四层阅读模式，帮助用户在摘要、精读与原文之间切换。",
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

export const topics: TopicReference[] = [
  {
    id: "t1",
    name: "学术助手界面",
    paperCount: 42,
    keywords: ["检索", "阅读器", "编排"],
  },
  {
    id: "t2",
    name: "Layered Reader",
    paperCount: 17,
    keywords: ["摘要", "精读", "PDF"],
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

export const libraryStats: StatCardReference[] = [
  {
    label: "总论文数",
    value: "12,480",
    badge: "LIVE",
    icon: Library,
    tone: "primary",
  },
  {
    label: "缺失 PDF",
    value: "312",
    badge: "ALERT",
    icon: BookOpen,
    tone: "error",
  },
  {
    label: "待入库",
    value: "98",
    badge: "SYNC",
    icon: FolderKanban,
    tone: "tertiary",
  },
  {
    label: "未索引",
    value: "425",
    badge: "WARN",
    icon: Database,
    tone: "secondary",
  },
];
