import type { LibraryTask, LibraryTaskKind } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { libraryApi } from "../../../core/library";
import { useLibraryEvents } from "../../../core/libraryEvents";
import { ACTIVE_TASK, TASK_PHASES, capability, taskProgress } from "../tasks";

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
  framed = false,
}: {
  kind: LibraryTaskKind;
  /** Say nothing once the capability is available. */
  hideWhenReady?: boolean;
  /** Lead with what the capability is for, for readers who arrived by accident. */
  explain?: boolean;
  /** Stand on its own, outside the panel that groups the capabilities. */
  framed?: boolean;
}) {
  const spec = capability(kind);
  const client = useQueryClient();
  const streaming = useLibraryEvents();
  const capabilities = useQuery({
    queryKey: ["library", "capabilities"],
    queryFn: ({ signal }) => libraryApi.capabilities(signal),
    // Task progress arrives on the change stream; polling covers it being down.
    refetchInterval: (query) =>
      !streaming && query.state.data?.tasks.some((task) => ACTIVE_TASK.includes(task.status))
        ? 1000
        : false,
  });
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
  return (
    <article
      className={`flex flex-col gap-1.5 ${
        framed
          ? "rounded-xl border border-outline-variant/15 bg-surface-container-low p-3 text-left"
          : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-on-surface">{spec.title}</h2>
        <div className="flex items-center gap-2">
          {blocked?.remedy ? (
            <Link
              to={blocked.remedy.to}
              className="text-[10px] font-mono font-bold text-primary hover:text-primary-container transition-colors"
            >
              {blocked.remedy.label}
            </Link>
          ) : null}
          <button
            type="button"
            disabled={start.isPending || cancel.isPending || (!running && blocked !== null)}
            onClick={() => (running ? cancel.mutate(kind) : start.mutate(kind))}
            className="text-[10px] font-mono font-bold text-primary disabled:text-on-surface-variant/40 hover:text-primary-container transition-colors"
          >
            {running ? "停止" : "开始"}
          </button>
        </div>
      </div>
      {explain ? <p className="text-xs text-on-surface-variant">{spec.purpose}</p> : null}
      <p className="text-xs text-on-surface-variant">{blocked?.message ?? spec.describe(state)}</p>
      <TaskProgress task={task} />
      {error ? <p className="text-[10px] text-error">{error.message}</p> : null}
    </article>
  );
}

function TaskProgress({ task }: { task?: LibraryTask }) {
  if (!task) return null;
  if (ACTIVE_TASK.includes(task.status))
    return (
      <p className="text-[10px] font-mono text-primary">
        {TASK_PHASES[task.phase ?? ""] ?? task.phase ?? "进行中"}
        {taskProgress(task.done, task.total)}
      </p>
    );
  if (task.status === "failed")
    return <p className="text-[10px] font-mono text-error">失败：{task.error}</p>;
  return (
    <p className="text-[10px] font-mono text-on-surface-variant/70">
      {task.status === "cancelled" ? "已停止" : "已完成"}
      {task.summary ? ` · ${task.summary}` : ""}
    </p>
  );
}
