import type { LibraryTaskKind } from "@scholaraio-hub/shared";

/** Task states that mean the worker still has it. */
export const ACTIVE_TASK = ["queued", "running"];

/** What each task is called wherever it is shown. */
export const TASK_NAMES: Record<LibraryTaskKind, string> = {
  semantic: "准备语义检索",
  topics: "构建主题",
  deep: "深度解析",
  quality: "质量补全",
};

/** Stages a task reports while it runs, in the order they happen. */
export const TASK_PHASES: Record<string, string> = {
  preparing: "准备中",
  model: "下载嵌入模型",
  embed: "生成向量",
  cluster: "聚类建模",
  artifacts: "写入分析结果",
  deep: "提取目录与结论",
  stopping: "正在停止",
};

/** How far a task has got, as the user reads it. */
export function taskProgress(done: number, total: number): string {
  return total ? ` · ${done}/${total}（${Math.round((done / total) * 100)}%）` : "…";
}
