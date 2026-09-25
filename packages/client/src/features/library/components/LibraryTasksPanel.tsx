import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../../../shared/ui/Dialog";
import { ACTIVE_TASK, CAPABILITIES, TASK_PHASES, taskProgress } from "../tasks";
import { CapabilityPrompt, useLibraryCapabilities } from "./CapabilityPrompt";

/** How each state reads at a glance: a dot, and the word beside it. */
const STATES = {
  running: { label: "进行中", dot: "bg-primary animate-pulse", text: "text-primary" },
  failed: { label: "失败", dot: "bg-error", text: "text-error" },
  ready: { label: "就绪", dot: "bg-primary", text: "text-primary" },
  pending: { label: "待运行", dot: "bg-tertiary", text: "text-tertiary" },
  blocked: { label: "不可用", dot: "bg-outline-variant", text: "text-on-surface-faint" },
} as const;

/**
 * Where the library's model-time work stands, in one card.
 *
 * The card only reports. Starting, re-running or stopping that work costs
 * minutes to hours, so it lives one step away, in a dialog opened on purpose,
 * where a stray click on the analysis page cannot reach it.
 */
export function LibraryTasksPanel() {
  const [managing, setManaging] = useState(false);
  const capabilities = useLibraryCapabilities();
  const state = capabilities.data;
  return (
    <section
      aria-label="文献库能力"
      className="shrink-0 rounded-lg border border-outline-variant/10 bg-surface-container-low"
    >
      <div className="flex items-center gap-2 border-b border-outline-variant/10 px-3 py-2">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          文献库能力
        </p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-bold text-primary hover:bg-primary/10"
        >
          <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
          管理
        </button>
      </div>
      <ul className="p-1.5">
        {CAPABILITIES.map((spec) => {
          if (!state)
            return (
              <li key={spec.kind} className="px-2 py-1.5">
                <span className="block h-3 w-1/2 rounded skeleton-shimmer" aria-hidden="true" />
              </li>
            );
          const task = state.tasks.find((item) => item.kind === spec.kind);
          const running = task ? ACTIVE_TASK.includes(task.status) : false;
          const blocked = running ? null : spec.blocked(state);
          const status = running
            ? "running"
            : task?.status === "failed"
              ? "failed"
              : spec.ready(state)
                ? "ready"
                : blocked
                  ? "blocked"
                  : "pending";
          const detail =
            running && task
              ? task.status === "queued"
                ? "排队中…"
                : `${TASK_PHASES[task.phase ?? ""] ?? task.phase ?? "进行中"}${taskProgress(task.done, task.total)}`
              : status === "failed"
                ? (task?.error ?? "上次运行失败")
                : (blocked?.message ?? spec.describe(state));
          const look = STATES[status];
          return (
            <li key={spec.kind} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${look.dot}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-on-surface">{spec.title}</span>
                  <span className={`shrink-0 font-mono text-[10px] font-bold ${look.text}`}>
                    {look.label}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-on-surface-variant" title={detail}>
                  {detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {managing ? (
        <Dialog
          title="文献库能力"
          description="这些任务会占用模型调用或本机算力，可能持续数分钟到数小时。"
          onClose={() => setManaging(false)}
          wide
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((item) => (
              <CapabilityPrompt key={item.kind} kind={item.kind} explain />
            ))}
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
