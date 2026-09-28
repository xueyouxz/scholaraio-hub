import type { ImportJob } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileText, Globe, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { libraryApi } from "../../../../core/library";
import { useLibraryStream } from "../../../../core/libraryEvents";
import {
  ACTIVE_IMPORT,
  INGESTED_IMPORT,
  type ImportItem,
  PIPELINE_STEPS,
  TONE_TEXT,
  importState,
} from "./pipeline";
import type { ImportSubmission } from "./submit";

/** Keep the import queue's jobs current while any of `mine` is still running. */
export function useImportJobs(active: boolean) {
  const streaming = useLibraryStream();
  return useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    enabled: active,
    // Progress arrives on the change stream; polling covers it being down.
    refetchInterval: (query) =>
      !streaming &&
      query.state.data?.jobs.some((job) =>
        job.items.some((item) => ACTIVE_IMPORT.includes(item.status)),
      )
        ? 1000
        : false,
  });
}

/**
 * Every entry handed to the queue from here, from upload to library, step by step.
 *
 * Before the queue has a job for an entry it is shown as being sent (or as
 * having failed to send); after, each file is a row of the job, carrying the
 * pipeline step it has reached.
 */
export function ImportProgress({ submission }: { submission: ImportSubmission }) {
  const client = useQueryClient();
  const jobs = useImportJobs(submission.jobs.length > 0);
  const retry = useMutation({
    mutationFn: libraryApi.retry,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library", "imports"] });
    },
  });
  const ours = (jobs.data?.jobs ?? []).filter((job) => submission.jobs.includes(job.id));
  const items = ours.flatMap((job) => job.items);
  const total = items.length + submission.rows.length;
  const settled = items.filter((item) => !ACTIVE_IMPORT.includes(item.status)).length;
  const ingested = items.filter(
    (item) => INGESTED_IMPORT.includes(item.status) || item.status === "duplicate",
  ).length;
  const failed =
    items.filter((item) => item.status === "failed").length +
    submission.rows.filter((row) => row.state === "failed").length;

  // Each paper the queue finishes is in the library from that moment, whether
  // or not the change stream is up to say so.
  const counted = useRef(settled);
  useEffect(() => {
    if (counted.current === settled) return;
    counted.current = settled;
    for (const key of ["papers", "collections", "collection"])
      void client.invalidateQueries({ queryKey: ["library", key] });
  }, [settled, client]);

  if (total === 0) return null;
  const done = settled + submission.rows.filter((row) => row.state === "failed").length;
  const percent = Math.round((done / total) * 100);
  return (
    <section aria-label="导入进度" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          进度
        </h3>
        <span className="text-[10px] font-mono text-on-surface-variant">
          完成 {ingested}/{total}
          {failed ? ` · ${failed} 失败` : ""}
        </span>
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-outline-variant/20"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ul aria-live="polite" className="flex min-h-0 flex-col gap-1 overflow-auto">
        {submission.rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-2"
          >
            {row.kind === "locator" ? (
              <Globe className="w-3.5 h-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            ) : (
              <FileText
                className="w-3.5 h-3.5 shrink-0 text-on-surface-variant"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-on-surface">{row.name}</span>
              {row.error ? (
                <span className="block truncate text-[11px] text-error" title={row.error}>
                  {row.error}
                </span>
              ) : null}
            </span>
            {row.state === "sending" ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase text-primary">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                {row.kind === "locator" ? "获取 PDF 中" : "上传中"}
              </span>
            ) : (
              <>
                <span className="text-[10px] font-mono font-bold uppercase text-error">
                  {row.kind === "locator" ? "获取失败" : "上传失败"}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${row.name}`}
                  onClick={() => submission.dismiss(row.id)}
                  className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </li>
        ))}
        {ours.map((job) => (
          <JobRows key={job.id} job={job} pending={retry.isPending} onRetry={retry.mutate} />
        ))}
      </ul>
      {retry.error ? <p className="text-xs text-error">{retry.error.message}</p> : null}
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
  const busy = job.items.some((item) => ACTIVE_IMPORT.includes(item.status));
  return (
    <>
      {job.items.map((item) => (
        <ImportRow
          key={item.id}
          item={item}
          retry={
            item.status === "failed"
              ? { disabled: pending || busy, run: () => onRetry(job.id) }
              : null
          }
        />
      ))}
    </>
  );
}

/** One file in the queue: its name, the pipeline step it is on, and how it ended. */
export function ImportRow({
  item,
  retry,
}: {
  item: ImportItem;
  retry: { disabled: boolean; run: () => void } | null;
}) {
  const state = importState(item);
  const running = item.status === "running";
  const ended = !ACTIVE_IMPORT.includes(item.status);
  const note = item.error ?? item.collectionError;
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-2">
      {state.tone === "error" ? (
        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-error" aria-hidden="true" />
      ) : ended ? (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Loader2
          className={`w-3.5 h-3.5 shrink-0 ${running ? "animate-spin text-primary" : "text-on-surface-variant/50"}`}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-on-surface">{item.title ?? item.name}</span>
        {note ? (
          <span className="block truncate text-[11px] text-error" title={note}>
            {note}
          </span>
        ) : null}
      </span>
      <StepTrack item={item} />
      <span
        className={`shrink-0 whitespace-nowrap text-right text-[10px] font-mono font-bold uppercase ${TONE_TEXT[state.tone]}`}
      >
        {state.label}
      </span>
      {retry ? (
        <button
          type="button"
          aria-label={`重试 ${item.name}`}
          title="重试"
          disabled={retry.disabled}
          onClick={retry.run}
          className="rounded-full p-1 text-primary hover:bg-primary/10"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      ) : null}
    </li>
  );
}

/** The four pipeline steps as segments, filled up to the one running. */
export function StepTrack({ item }: { item: ImportItem }) {
  const state = importState(item);
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
      {PIPELINE_STEPS.map((step, index) => {
        const reached = index < state.reached;
        const current = item.status === "running" && index === state.reached;
        return (
          <span
            key={step.id}
            title={step.label}
            className={`h-1 w-3 rounded-full transition-colors duration-300 ${
              state.tone === "error"
                ? "bg-error/30"
                : reached
                  ? "bg-primary"
                  : current
                    ? "bg-primary/50 animate-pulse"
                    : "bg-outline-variant/40"
            }`}
          />
        );
      })}
    </span>
  );
}
