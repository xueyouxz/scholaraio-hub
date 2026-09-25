import type { LibraryTask, LibraryTaskKind } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { libraryApi } from "../../../core/library";
import { useLibraryStream } from "../../../core/libraryEvents";
import { ACTIVE_TASK, TASK_NAMES, TASK_PHASES, capability, taskProgress } from "../tasks";

/**
 * What the library can do now, and the work under way to change that.
 *
 * Task progress arrives on the change stream; while one runs and the stream is
 * down, polling stands in for it.
 */
export function useLibraryCapabilities() {
  const streaming = useLibraryStream();
  return useQuery({
    queryKey: ["library", "capabilities"],
    queryFn: ({ signal }) => libraryApi.capabilities(signal),
    refetchInterval: (query) =>
      !streaming && query.state.data?.tasks.some((task) => ACTIVE_TASK.includes(task.status))
        ? 1000
        : false,
  });
}

/**
 * One piece of library work, offered where the user runs into needing it.
 *
 * The same card serves the control panel and the places that depend on the
 * capability — a semantic search with no vectors, an empty topic map — so the
 * answer to "why doesn't this work" is the button that fixes it.
 */
export function CapabilityPrompt({
  kind,
  hideWhenReady = false,
  explain = false,
}: {
  kind: LibraryTaskKind;
  /** Say nothing once the capability is available. */
  hideWhenReady?: boolean;
  /** Lead with what the capability is for, for readers who arrived by accident. */
  explain?: boolean;
}) {
  const spec = capability(kind);
  const client = useQueryClient();
  const capabilities = useLibraryCapabilities();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const start = useMutation({ mutationFn: libraryApi.startTask, onSuccess: refresh });
  const cancel = useMutation({ mutationFn: libraryApi.cancelTask, onSuccess: refresh });

  const state = capabilities.data;
  if (!state) return null;
  const task = state.tasks.find((item) => item.kind === kind);
  const running = task ? ACTIVE_TASK.includes(task.status) : false;
  if (hideWhenReady && spec.ready(state) && !running) return null;
  const blocked = running ? null : spec.blocked(state);
  const error = start.error ?? cancel.error;
  const ready = spec.ready(state);
  const suggested = !running && !ready && blocked === null;
  const label = running
    ? "停止"
    : ready
      ? "重新运行"
      : ((blocked === null ? spec.action?.(state) : null) ?? "开始");
  const button = (
    <button
      type="button"
      disabled={start.isPending || cancel.isPending || (!running && blocked !== null)}
      onClick={() => (running ? cancel.mutate(kind) : start.mutate(kind))}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold active:scale-95 disabled:opacity-40 ${suggested ? "signature-gradient text-on-primary" : "bg-surface-container-high text-on-surface"}`}
    >
      {label}
    </button>
  );
  const badge =
    ready && !running && blocked === null ? (
      <span className="shrink-0 rounded bg-primary-container/10 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase leading-none text-primary">
        就绪
      </span>
    ) : null;
  const remedy = blocked?.remedy ? (
    <Link
      to={blocked.remedy.to}
      className="shrink-0 text-[10px] font-mono font-bold uppercase tracking-wider text-primary hover:text-primary-container"
    >
      {blocked.remedy.label}
    </Link>
  ) : null;

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-base font-semibold text-on-surface">{spec.title}</h2>
        {badge}
      </div>
      {explain ? <p className="text-xs text-on-surface-variant">{spec.purpose}</p> : null}
      <p className="text-xs text-on-surface-variant">{blocked?.message ?? spec.describe(state)}</p>
      <TaskProgress task={task} />
      {error ? <p className="text-[10px] text-error">{error.message}</p> : null}
      {blocked?.install === "vector-runtime" ? <VectorRuntimeInstall /> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {button}
        {remedy}
      </div>
    </article>
  );
}

/**
 * The one install that stands between a fresh Hub and semantic search.
 *
 * The packages are a multi-gigabyte download that most installs never need, so
 * setup leaves them out and this button fetches them when they are first asked
 * for. The Hub restarts the library service itself once they land.
 */
function VectorRuntimeInstall() {
  const client = useQueryClient();
  const runtime = useQuery({
    queryKey: ["library", "runtime"],
    queryFn: ({ signal }) => libraryApi.vectorRuntime(signal),
    refetchInterval: (query) => (query.state.data?.state === "installing" ? 2000 : false),
  });
  const install = useMutation({
    mutationFn: libraryApi.installVectorRuntime,
    onSuccess: (status) => client.setQueryData(["library", "runtime"], status),
  });
  const state = runtime.data?.state;
  const installing = state === "installing";
  // The capability list is what says whether the packages are importable now.
  const settled = useRef(state);
  useEffect(() => {
    if (settled.current === state) return;
    settled.current = state;
    if (state === "ready") void client.invalidateQueries({ queryKey: ["library"] });
  }, [state, client]);
  const log = runtime.data?.log ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={installing || install.isPending}
        onClick={() => install.mutate()}
        className="self-start rounded-full signature-gradient px-3 py-1.5 text-xs font-semibold text-on-primary active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
      >
        {installing ? "安装中…" : state === "failed" ? "重新安装" : "安装语义检索运行时"}
      </button>
      {runtime.data?.error ? (
        <p className="text-[10px] text-error break-words">{runtime.data.error}</p>
      ) : null}
      {install.error ? (
        <p className="text-[10px] text-error break-words">{install.error.message}</p>
      ) : null}
      {log.length ? (
        <pre
          aria-live="polite"
          className="max-h-24 overflow-auto rounded-lg bg-surface-container px-2 py-1.5 text-[10px] font-mono leading-relaxed text-on-surface-variant whitespace-pre-wrap"
        >
          {log.slice(-6).join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

export function TaskProgress({ task }: { task?: LibraryTask }) {
  if (!task) return null;
  if (task.status === "queued")
    return (
      <p className="truncate text-[10px] font-mono text-on-surface-variant">
        排队中{task.waitingFor ? ` · 等待「${TASK_NAMES[task.waitingFor]}」完成` : "…"}
      </p>
    );
  if (ACTIVE_TASK.includes(task.status))
    return (
      <p className="truncate text-[10px] font-mono text-primary">
        {TASK_PHASES[task.phase ?? ""] ?? task.phase ?? "进行中"}
        {taskProgress(task.done, task.total)}
      </p>
    );
  if (task.status === "failed")
    return (
      <p className="truncate text-[10px] font-mono text-error" title={task.error ?? undefined}>
        失败：{task.error}
      </p>
    );
  return (
    <p className="text-[10px] font-mono text-on-surface-variant/70">
      {task.status === "cancelled" ? "已停止" : "已完成"}
      {task.summary ? ` · ${task.summary}` : ""}
    </p>
  );
}
