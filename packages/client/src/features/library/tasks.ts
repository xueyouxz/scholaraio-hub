import type { LibraryCapabilities, LibraryTaskKind } from "@scholaraio-hub/shared";

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
  runtime: "安装向量依赖",
  model: "下载嵌入模型",
  embed: "生成向量",
  cluster: "聚类建模",
  artifacts: "写入分析结果",
  deep: "提取目录与结论",
  abstracts: "补全摘要",
  stopping: "正在停止",
};

/** How far a task has got, as the user reads it. */
export function taskProgress(done: number, total: number): string {
  return total ? ` · ${done}/${total}（${Math.round((done / total) * 100)}%）` : "…";
}

/** Why a task cannot start, and where the user can go to change that. */
export interface Blocked {
  message: string;
  remedy?: { label: string; to: string };
  /** The capability is one install away, and the Hub can run it from here. */
  install?: "vector-runtime";
}

export interface Capability {
  kind: LibraryTaskKind;
  title: string;
  /** What this capability buys the user, said before they pay for it. */
  purpose: string;
  describe: (state: LibraryCapabilities) => string;
  ready: (state: LibraryCapabilities) => boolean;
  blocked: (state: LibraryCapabilities) => Blocked | null;
  /** What the start button says when the work is neither done nor new. */
  action?: (state: LibraryCapabilities) => string | null;
}

export const CAPABILITIES: Capability[] = [
  {
    kind: "semantic",
    title: "语义检索",
    purpose: "按意思而不是字面检索文献",
    describe: (state) =>
      state.semanticReady
        ? `${state.vectors}/${state.papers} 篇已有向量`
        : state.embedProvider === "openai-compat"
          ? `通过 API 为 ${state.papers} 篇论文生成向量（模型 ${state.embedModel}），可能产生调用费用`
          : `需要为 ${state.papers} 篇论文生成向量（模型 ${state.embedModel}${
              state.modelReady ? " 已就绪" : " 需先下载"
            }）`,
    ready: (state) => state.semanticReady,
    blocked: (state) =>
      state.embedProvider !== "openai-compat" && !state.vectorRuntimeReady
        ? {
            message: "语义检索运行时尚未安装（向量模型依赖，首次安装需要下载数 GB）",
            install: "vector-runtime",
          }
        : state.embedProvider === "none"
          ? {
              message: "向量嵌入已停用，请在设置中选择本地模型或 API",
              remedy: { label: "前往设置", to: "/settings" },
            }
          : state.papers === 0
            ? {
                message: "文献库还没有论文",
                remedy: { label: "导入文献", to: "/library?import=1" },
              }
            : null,
  },
  {
    kind: "topics",
    title: "主题地图",
    purpose: "把文献库聚成主题，并画出它们的分布与趋势",
    describe: (state) =>
      !state.topicsBuilt
        ? "尚未建立主题，分析页会是空的"
        : state.mappedPapers < state.vectors
          ? `投影含 ${state.mappedPapers} 篇，另有 ${state.vectors - state.mappedPapers} 篇待加入`
          : `投影含 ${state.mappedPapers} 篇，已是最新`,
    // The map is only as current as the vectors it was drawn from.
    ready: (state) => state.topicsBuilt && state.mappedPapers >= state.vectors,
    blocked: (state) => (state.semanticReady ? null : { message: "请先准备语义检索" }),
    action: (state) => (state.topicsBuilt ? "更新投影" : null),
  },
  {
    kind: "deep",
    title: "深度解析",
    purpose: "提取每篇论文的目录与结论",
    describe: (state) =>
      state.deepPending ? `${state.deepPending} 篇缺少目录或结论` : "所有论文都已解析",
    ready: (state) => state.deepPending === 0,
    blocked: (state) =>
      !state.llmConfigured
        ? {
            message: "需要先配置 LLM API Key",
            remedy: { label: "前往设置", to: "/settings" },
          }
        : state.deepPending === 0
          ? { message: "没有待处理的论文" }
          : null,
  },
  {
    kind: "quality",
    title: "质量补全",
    purpose: "为缺少摘要的论文补回摘要",
    describe: (state) =>
      state.missingAbstracts ? `${state.missingAbstracts} 篇缺少摘要` : "所有论文都有摘要",
    ready: (state) => state.missingAbstracts === 0,
    blocked: (state) => (state.missingAbstracts ? null : { message: "没有待补全的论文" }),
  },
];

export function capability(kind: LibraryTaskKind): Capability {
  const found = CAPABILITIES.find((item) => item.kind === kind);
  if (!found) throw new Error(`未知的文献库任务：${kind}`);
  return found;
}
