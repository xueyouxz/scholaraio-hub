import type { LibraryCapabilities, LibraryTask, LibraryTaskKind } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { libraryApi } from "../../../core/library";

/** Stages a task reports while it runs, in the order they happen. */
const PHASES: Record<string, string> = {
  preparing: "准备中",
  model: "下载嵌入模型",
  embed: "生成向量",
  cluster: "聚类建模",
  artifacts: "写入分析结果",
  deep: "提取目录与结论",
  stopping: "正在停止",
};

const RUNNING = ["queued", "running"];

type Capability = {
  kind: LibraryTaskKind;
  title: string;
  describe: (state: LibraryCapabilities) => string;
  blocked: (state: LibraryCapabilities) => string | null;
};

const CAPABILITIES: Capability[] = [
  {
    kind: "semantic",
    title: "语义检索",
    describe: (state) =>
      state.semanticReady
        ? `${state.vectors}/${state.papers} 篇已有向量`
        : `尚未建立向量（模型 ${state.embedModel}${state.modelReady ? "已就绪" : "需先下载"}）`,
    blocked: (state) =>
      state.embedProvider === "none"
        ? "配置中关闭了向量嵌入"
        : state.papers === 0
          ? "文献库还没有论文"
          : null,
  },
  {
    kind: "topics",
    title: "主题地图",
    describe: (state) =>
      state.topicsBuilt ? "已建立主题与二维投影" : "尚未建立主题，分析页会是空的",
    blocked: (state) => (state.semanticReady ? null : "请先准备语义检索"),
  },
  {
    kind: "deep",
    title: "深度解析",
    describe: (state) =>
      state.deepPending ? `${state.deepPending} 篇缺少目录或结论` : "所有论文都已解析",
    blocked: (state) =>
      !state.llmConfigured
        ? "需要先在设置中配置 LLM API Key"
        : state.deepPending === 0
          ? "没有待处理的论文"
          : null,
  },
];

/** Start, watch and stop the library work that costs model time. */
export function LibraryTasksPanel() {
  const client = useQueryClient();
  const capabilities = useQuery({
    queryKey: ["library", "capabilities"],
    queryFn: ({ signal }) => libraryApi.capabilities(signal),
    refetchInterval: (query) =>
      query.state.data?.tasks.some((task) => RUNNING.includes(task.status)) ? 1000 : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const start = useMutation({ mutationFn: libraryApi.startTask, onSuccess: refresh });
  const cancel = useMutation({ mutationFn: libraryApi.cancelTask, onSuccess: refresh });
  const state = capabilities.data;
  if (!state) return null;
  const error = capabilities.error ?? start.error ?? cancel.error;
  return (
    <section
      aria-label="文献库能力"
      className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-lg p-3 flex flex-col gap-2"
    >
      {error ? <p className="text-xs text-error">{error.message}</p> : null}
      <div className="grid gap-2 md:grid-cols-3">
        {CAPABILITIES.map((capability) => {
          const task = state.tasks.find((item) => item.kind === capability.kind);
          const running = task ? RUNNING.includes(task.status) : false;
          const blocked = running ? null : capability.blocked(state);
          return (
            <article key={capability.kind} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-on-surface">{capability.title}</h2>
                <button
                  type="button"
                  disabled={start.isPending || cancel.isPending || (!running && blocked !== null)}
                  onClick={() =>
                    running ? cancel.mutate(capability.kind) : start.mutate(capability.kind)
                  }
                  className="text-[10px] font-mono font-bold text-primary disabled:text-on-surface-variant/40 hover:text-primary-container transition-colors"
                >
                  {running ? "停止" : "开始"}
                </button>
              </div>
              <p className="text-xs text-on-surface-variant">
                {blocked ?? capability.describe(state)}
              </p>
              <TaskProgress task={task} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TaskProgress({ task }: { task?: LibraryTask }) {
  if (!task) return null;
  if (RUNNING.includes(task.status)) {
    const phase = PHASES[task.phase ?? ""] ?? task.phase ?? "进行中";
    const percent = task.total ? Math.round((task.done / task.total) * 100) : null;
    return (
      <p className="text-[10px] font-mono text-primary">
        {phase}
        {percent === null ? "…" : ` · ${task.done}/${task.total} (${percent}%)`}
      </p>
    );
  }
  if (task.status === "failed")
    return <p className="text-[10px] font-mono text-error">失败：{task.error}</p>;
  return (
    <p className="text-[10px] font-mono text-on-surface-variant/70">
      {task.status === "cancelled" ? "已停止" : "已完成"}
      {task.summary ? ` · ${task.summary}` : ""}
    </p>
  );
}
