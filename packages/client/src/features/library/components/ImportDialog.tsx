import type { LibraryTask } from "@scholaraio-hub/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../../../core/library";
import { useLibraryStream } from "../../../core/libraryEvents";
import { Dialog } from "../../../shared/ui/Dialog";
import { ACTIVE_TASK, TASK_PHASES, taskProgress } from "../tasks";
import { ImportProgress, useImportJobs } from "./import/ImportProgress";
import { ACTIVE_IMPORT, INGESTED_IMPORT } from "./import/pipeline";
import { ImportStaging, type Staged } from "./import/sources";
import { useImportSubmission } from "./import/submit";

/**
 * Every way a paper gets into the library, and what happens to it afterwards.
 *
 * Choosing is not importing: what the user picks — found on the web or taken
 * from disk — is staged, listed and still removable until they confirm. Past
 * that everything shares one queue, shown here step by step, with vector
 * generation offered as its follow-on.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [embed, setEmbed] = useState(false);
  const submission = useImportSubmission();
  const jobs = useImportJobs(submission.jobs.length > 0);
  const items = (jobs.data?.jobs ?? [])
    .filter((job) => submission.jobs.includes(job.id))
    .flatMap((job) => job.items);
  const busy = submission.busy || items.some((item) => ACTIVE_IMPORT.includes(item.status));
  const ingested = items.filter((item) => INGESTED_IMPORT.includes(item.status)).length;

  return (
    <Dialog wide tall title="导入文献" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <ImportStaging
          staged={staged}
          onAdd={(entries) => setStaged((previous) => [...previous, ...entries])}
          onDrop={(id) => setStaged((previous) => previous.filter((item) => item.id !== id))}
          onClear={() => setStaged([])}
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={embed}
            onClick={() => setEmbed((value) => !value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
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
            disabled={!staged.length || submission.busy}
            onClick={() => {
              const entries = staged;
              setStaged([]);
              void submission.submit(entries);
            }}
            className="signature-gradient rounded-full px-4 py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40"
          >
            {submission.busy ? "提交中…" : `确定导入${staged.length ? ` (${staged.length})` : ""}`}
          </button>
        </div>

        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col">
          <ImportProgress submission={submission} />
          <VectorStage run={embed && !busy && ingested > 0} />
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Vectors for what was just imported.
 *
 * Embedding is not part of an import — it costs model time and, the first
 * time, a download — so it starts only once the queue is done and only when
 * the user asked for it here.
 */
function VectorStage({ run }: { run: boolean }) {
  const streaming = useLibraryStream();
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
