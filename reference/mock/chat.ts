import type { MessageReference, ToolResultReference } from "../types/ui";
import { papers, topics, workspaces } from "./entities";

const toolResults: ToolResultReference[] = [
  { kind: "papers", papers: papers.slice(0, 2) },
  { kind: "topics", topics },
  {
    kind: "workspace",
    workspaceResult: {
      operation: "updated",
      workspace: workspaces[0],
    },
  },
];

export const chatMessages: MessageReference[] = [
  {
    id: "m1",
    role: "user",
    content: "请梳理学术助手界面的核心模块，并给我一个适合重构的 UI 组件分层。",
    attachments: [
      { id: "a1", name: "ui-audit.pdf", kind: "file" },
      { id: "a2", name: "reader-panel.png", kind: "image" },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "我建议按 `primitives / sections / pages` 三层拆分。先抽离导航、状态徽标、统计卡、论文卡片，再整理页面级区域，例如检索过滤区、阅读器侧栏、设置卡片组。",
    toolCalls: [
      { toolName: "paper_search", status: "done" },
      { toolName: "workspace_lookup", status: "pending" },
    ],
    toolResults,
  },
  {
    id: "m3",
    role: "user",
    content: "把阅读器和聊天区里重复出现的卡片也纳入设计稿素材。",
    editing: true,
  },
];

export const explorerKeywords = ["信息架构", "阅读分层", "工作区", "引用链"];
