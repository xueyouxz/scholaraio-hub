import type { LibraryTask } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../../../core/library";
import { useLibraryStream } from "../../../core/libraryEvents";
import { ACTIVE_TASK, TASK_NAMES, TASK_PHASES, taskProgress } from "../tasks";

/**
 * What the library is busy with, wherever the user happens to be.
 *
 * Imports and model work run for minutes and outlive the page that started
 * them, so their progress belongs in the chrome rather than on one screen.
 * The indicator appears only while something is running.
 */
export function LibraryActivityTray({ collapsed }: { collapsed: boolean }) {
  const streaming = useLibraryStream();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // Progress arrives on the change stream; polling covers it being down.
  const poll = (busy: boolean) => (!streaming && busy ? 1000 : (false as const));
  const capabilities = useQuery({
    queryKey: ["library", "capabilities"],
    queryFn: ({ signal }) => libraryApi.capabilities(signal),
    refetchInterval: (query) =>
      poll((query.state.data?.tasks ?? []).some((task) => ACTIVE_TASK.includes(task.status))),
  });
  const jobs = useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    refetchInterval: (query) =>
      poll(
        (query.state.data?.jobs ?? []).some((job) =>
          job.items.some((item) => ACTIVE_TASK.includes(item.status)),
        ),
      ),
  });
  const tasks = (capabilities.data?.tasks ?? []).filter((task) =>
    ACTIVE_TASK.includes(task.status),
  );
  const importing = (jobs.data?.jobs ?? []).flatMap((job) => job.items);
  const pendingImports = importing.filter((item) => ACTIVE_TASK.includes(item.status));
  const busy = tasks.length + (pendingImports.length ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const cancel = useMutation({
    mutationFn: libraryApi.cancelTask,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library", "capabilities"] });
    },
  });

  if (busy === 0) return null;
  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${busy} 项进行中`}
        className="w-full flex items-center gap-2.5 rounded-lg px-[11px] py-2 text-[12.5px] font-medium text-primary hover:bg-surface-container transition-colors"
      >
        <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />
        <span
          className={`truncate whitespace-nowrap transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}
        >
          {busy} 项进行中
        </span>
      </button>
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-40 w-72 rounded-xl border border-outline-variant/20 bg-surface-container-highest p-2 shadow-xl">
          {tasks.map((task) => (
            <TaskRow
              key={task.kind}
              task={task}
              pending={cancel.isPending}
              onCancel={() => cancel.mutate(task.kind)}
            />
          ))}
          {pendingImports.length ? (
            <div className="px-2 py-1.5">
              <p className="text-xs text-on-surface">导入文献</p>
              <p className="text-[10px] font-mono text-primary">
                {importing.length - pendingImports.length}/{importing.length} 已处理
              </p>
            </div>
          ) : null}
          {cancel.error ? (
            <p role="alert" className="px-2 text-[10px] text-error">
              {cancel.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  pending,
  onCancel,
}: {
  task: LibraryTask;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 px-2 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-on-surface">{TASK_NAMES[task.kind]}</p>
        <p className="text-[10px] font-mono text-primary">
          {TASK_PHASES[task.phase ?? ""] ?? task.phase ?? "进行中"}
          {taskProgress(task.done, task.total)}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending || task.phase === "stopping"}
        className="text-[10px] font-mono font-bold text-on-surface-variant hover:text-error disabled:opacity-40 border-0 bg-transparent cursor-pointer"
      >
        停止
      </button>
    </div>
  );
}
