import type { ImportJob, LibraryTask } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../../../core/library";
import { useLibraryEvents } from "../../../core/libraryEvents";
import { Dialog } from "../../../shared/ui/Dialog";
import { ACTIVE_TASK, TASK_PHASES, taskProgress } from "../tasks";
import { ImportStaging, type Staged } from "./import/sources";
import { submitStaged } from "./import/submit";

/** The ingest pipeline, in the order the import queue runs it. */
const STEPS = [
  { id: "mineru", label: "转换" },
  { id: "extract", label: "提取" },
  { id: "dedup", label: "查重" },
  { id: "ingest", label: "入库" },
];

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "排队中", tone: "text-on-surface-variant/70" },
  running: { label: "处理中", tone: "text-primary" },
  completed: { label: "已入库", tone: "text-primary" },
  completed_incomplete: { label: "已入库 · 元数据不完整", tone: "text-secondary" },
  duplicate: { label: "已存在", tone: "text-on-surface-variant" },
  needs_review: { label: "待确认", tone: "text-tertiary" },
  failed: { label: "失败", tone: "text-error" },
};

const ACTIVE = ["queued", "running"];
const INGESTED = ["completed", "completed_incomplete"];

/**
 * Every way a paper gets into the library, and what happens to it afterwards.
 *
 * Choosing is not importing: what the user picks is staged, listed and still
 * removable until they confirm. Past that the three sources share one queue,
 * shown here step by step, with vector generation offered as its follow-on.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [embed, setEmbed] = useState(false);
  const [mine, setMine] = useState<string[]>([]);
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const add = (entry: Staged) => setStaged((previous) => [...previous, entry]);
  const drop = (id: string) => setStaged((previous) => previous.filter((item) => item.id !== id));

  const send = useMutation({
    mutationFn: submitStaged,
    onSuccess: ({ jobs }) => {
      setMine((previous) => [...previous, ...jobs]);
      setStaged([]);
      refresh();
    },
  });
  const skipped = send.data?.skipped ?? [];

  return (
    <Dialog wide title="导入文献" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ImportStaging staged={staged} onAdd={add} onDrop={drop} />

        {skipped.length ? (
          <p className="text-xs text-on-surface-variant">
            {skipped.length} 条未能获取 PDF：
            {skipped
              .slice(0, 3)
              .map((entry) => entry.title)
              .join("、")}
            {skipped.length > 3 ? " 等" : ""}
          </p>
        ) : null}

        {send.error ? (
          <p role="alert" className="text-xs text-error">
            {send.error.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={embed}
            onClick={() => setEmbed((value) => !value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              embed
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-high text-on-surface-variant border-outline-variant/30"
            }`}
          >
            入库后生成向量
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!staged.length || send.isPending}
            onClick={() => send.mutate(staged)}
            className="signature-gradient rounded-full px-4 py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40 border-0 cursor-pointer"
          >
            {send.isPending ? "提交中…" : `确定导入${staged.length ? ` (${staged.length})` : ""}`}
          </button>
        </div>

        <ImportQueue jobs={mine} embed={embed} />
      </div>
    </Dialog>
  );
}

/** What the queue is doing with what this dialog handed it. */
function ImportQueue({ jobs: mine, embed }: { jobs: string[]; embed: boolean }) {
  const streaming = useLibraryEvents();
  const client = useQueryClient();
  const jobs = useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    enabled: mine.length > 0,
    // Progress arrives on the change stream; polling covers it being down.
    refetchInterval: (query) =>
      !streaming &&
      query.state.data?.jobs.some(
        (job) => mine.includes(job.id) && job.items.some((item) => ACTIVE.includes(item.status)),
      )
        ? 1000
        : false,
  });
  const retry = useMutation({
    mutationFn: libraryApi.retry,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
    },
  });
  const ours = (jobs.data?.jobs ?? []).filter((job) => mine.includes(job.id));
  const items = ours.flatMap((job) => job.items);
  const busy = items.some((item) => ACTIVE.includes(item.status));
  const ingested = items.filter((item) => INGESTED.includes(item.status)).length;
  const settled = items.length - items.filter((item) => ACTIVE.includes(item.status)).length;

  // Each paper the queue finishes is in the library from that moment, whether
  // or not the change stream is up to say so.
  const counted = useRef(settled);
  useEffect(() => {
    if (counted.current === settled) return;
    counted.current = settled;
    void client.invalidateQueries({ queryKey: ["library", "browse"] });
    void client.invalidateQueries({ queryKey: ["library", "papers"] });
  }, [settled, client]);

  if (!ours.length) return null;
  return (
    <section className="border-t border-outline-variant/10 pt-3">
      <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
        进度
      </h3>
      <div aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-auto">
        {ours.map((job) => (
          <JobRows key={job.id} job={job} pending={retry.isPending} onRetry={retry.mutate} />
        ))}
      </div>
      {retry.error ? <p className="mt-1 text-xs text-error">{retry.error.message}</p> : null}
      <VectorStage run={embed && !busy && ingested > 0} />
    </section>
  );
}

function JobRows({
  job,
  pending,
  onRetry,
}: {
  job: ImportJob;
  pending: boolean;
  onRetry: (id: string) => void;
}) {
  const failed = job.items.some((item) => item.status === "failed");
  const busy = job.items.some((item) => ACTIVE.includes(item.status));
  return (
    <div className="flex flex-col gap-1">
      {job.items.map((item) => {
        const status = STATUS[item.status] ?? { label: item.status, tone: "text-on-surface" };
        const reached = STEPS.findIndex((step) => step.id === item.step);
        const settled = !ACTIVE.includes(item.status);
        return (
          <div key={item.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{item.name}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {STEPS.map((step, index) => (
                <span
                  key={step.id}
                  title={step.label}
                  className={`h-1.5 w-1.5 rounded-full ${
                    settled
                      ? item.status === "failed"
                        ? "bg-error/40"
                        : "bg-primary"
                      : index <= reached
                        ? "bg-primary"
                        : "bg-outline-variant/40"
                  }`}
                />
              ))}
            </span>
            <span className={`text-[10px] font-mono font-bold uppercase ${status.tone}`}>
              {item.status === "running" && reached >= 0
                ? `${STEPS[reached]?.label ?? ""}中`
                : status.label}
            </span>
          </div>
        );
      })}
      <JobError job={job} />
      {failed ? (
        <button
          type="button"
          disabled={pending || busy}
          onClick={() => onRetry(job.id)}
          className="self-start text-[10px] font-mono font-bold text-primary disabled:text-on-surface-variant/40 border-0 bg-transparent cursor-pointer p-0"
        >
          重试失败项
        </button>
      ) : null}
    </div>
  );
}

/** The first thing that went wrong in this batch, said once rather than per row. */
function JobError({ job }: { job: ImportJob }) {
  const failed = job.items.find((item) => item.error);
  if (!failed?.error) return null;
  return <p className="text-[10px] text-error break-words">{failed.error}</p>;
}

/**
 * Vectors for what was just imported.
 *
 * Embedding is not part of an import — it costs model time and, the first
 * time, a download — so it starts only once the queue is done and only when
 * the user asked for it here.
 */
function VectorStage({ run }: { run: boolean }) {
  const streaming = useLibraryEvents();
  const capabilities = useQuery({
    queryKey: ["library", "capabilities"],
    queryFn: ({ signal }) => libraryApi.capabilities(signal),
    refetchInterval: (query) =>
      !streaming && query.state.data?.tasks.some((task) => ACTIVE_TASK.includes(task.status))
        ? 1000
        : false,
  });
  const start = useMutation({ mutationFn: libraryApi.startTask });
  const task = capabilities.data?.tasks.find((item) => item.kind === "semantic");
  const running = task ? ACTIVE_TASK.includes(task.status) : false;

  const asked = useRef(false);
  useEffect(() => {
    if (!run || asked.current || running) return;
    asked.current = true;
    start.mutate("semantic");
  }, [run, running, start]);

  if (!run && !running) return null;
  return (
    <div className="mt-2 flex items-center gap-3 border-t border-outline-variant/10 pt-2">
      <span className="min-w-0 flex-1 truncate text-xs text-on-surface">向量生成</span>
      <span className="text-[10px] font-mono font-bold uppercase text-primary">
        <VectorState task={task} error={start.error} running={running} />
      </span>
    </div>
  );
}

function VectorState({
  task,
  error,
  running,
}: {
  task?: LibraryTask;
  error: Error | null;
  running: boolean;
}) {
  if (error) return <span className="text-error">{error.message}</span>;
  if (running && task)
    return (
      <>
        {TASK_PHASES[task.phase ?? ""] ?? task.phase ?? "进行中"}
        {taskProgress(task.done, task.total)}
      </>
    );
  if (task?.status === "failed") return <span className="text-error">失败：{task.error}</span>;
  if (task?.status === "completed") return <>{task.summary ?? "已完成"}</>;
  return <>等待入库完成</>;
}
