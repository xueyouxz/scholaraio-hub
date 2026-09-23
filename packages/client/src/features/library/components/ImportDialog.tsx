import type { ImportJob } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderOpen, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../../../core/library";
import { useLibraryEvents } from "../../../core/libraryEvents";
import { ChipGroup } from "../../../shared/ui/ChipGroup";
import { Dialog } from "../../../shared/ui/Dialog";

/** The ingest pipeline, in the order the import queue runs it. */
const STEPS = [
  { id: "mineru", label: "解析" },
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

const SOURCES = [
  { value: "files", label: "本地文件" },
  { value: "locator", label: "按标识获取" },
  { value: "references", label: "书目文件" },
];

/**
 * Every way a paper gets into the library, and what happens to it afterwards.
 *
 * The three sources differ only in how the file is found; past that they share
 * one pipeline, so they share one dialog, with the queue's progress under them.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState("files");
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["library"] });
  };
  const upload = useMutation({ mutationFn: libraryApi.upload, onSuccess: refresh });
  const acquire = useMutation({ mutationFn: libraryApi.fetchPaper, onSuccess: refresh });
  const references = useMutation({ mutationFn: libraryApi.importReferences, onSuccess: refresh });
  const error = upload.error ?? acquire.error ?? references.error;
  return (
    <Dialog
      wide
      title="导入文献"
      description="PDF、标识符或书目文件，进入的都是同一条入库流水线。"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <ChipGroup label="来源" value={source} options={SOURCES} onChange={setSource} />

        {source === "files" ? (
          <FileSource pending={upload.isPending} onFiles={(files) => upload.mutate(files)} />
        ) : null}
        {source === "locator" ? (
          <LocatorSource
            pending={acquire.isPending}
            onSubmit={(locator) => acquire.mutate(locator)}
          />
        ) : null}
        {source === "references" ? (
          <ReferenceSource
            pending={references.isPending}
            skipped={references.data?.skipped ?? []}
            onFile={(file) => references.mutate(file)}
          />
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-error">
            {error.message}
          </p>
        ) : null}

        <ImportQueue />
      </div>
    </Dialog>
  );
}

function FileSource({
  pending,
  onFiles,
}: {
  pending: boolean;
  onFiles: (files: File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  const accept = (list: FileList | null) => {
    const pdfs = Array.from(list ?? []).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) onFiles(pdfs);
  };
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        accept(event.dataTransfer.files);
      }}
      className={`rounded-xl border border-dashed p-6 text-center transition-colors ${
        over ? "border-primary bg-primary/5" : "border-outline-variant/30 bg-surface-container-low"
      }`}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="application/pdf"
        className="sr-only"
        aria-label="选择 PDF 文件"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        aria-label="选择文献目录"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="text-sm text-on-surface-variant">把 PDF 拖到这里，或</p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileInput.current?.click()}
          className="signature-gradient text-on-primary font-semibold text-sm rounded-full px-4 py-2 active:scale-95 disabled:opacity-50 border-0 cursor-pointer inline-flex items-center gap-2"
        >
          <Upload className="w-3.5 h-3.5" />
          {pending ? "上传中…" : "选择 PDF"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => folderInput.current?.click()}
          className="rounded-full px-4 py-2 text-sm font-medium bg-surface-container-high text-on-surface active:scale-95 disabled:opacity-50 border-0 cursor-pointer inline-flex items-center gap-2"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          选择目录
        </button>
      </div>
    </div>
  );
}

function LocatorSource({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (locator: string) => void;
}) {
  const [locator, setLocator] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (locator.trim()) {
          onSubmit(locator.trim());
          setLocator("");
        }
      }}
    >
      <div className="flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container px-4 py-1.5 focus-within:ring-2 focus-within:ring-primary/20">
        <label className="sr-only" htmlFor="import-locator">
          按标识获取文献
        </label>
        <input
          id="import-locator"
          name="locator"
          value={locator}
          onChange={(event) => setLocator(event.target.value)}
          placeholder="DOI、arXiv 编号、专利号或论文链接…"
          className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
        />
        <button
          type="submit"
          disabled={pending || !locator.trim()}
          aria-label="获取并入库"
          className="rounded-full p-1.5 text-primary hover:bg-primary/10 disabled:text-on-surface-variant/40 border-0 bg-transparent cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
        {pending ? "获取中…" : "arXiv · DOI · 专利 · 论文页链接"}
      </p>
    </form>
  );
}

function ReferenceSource({
  pending,
  skipped,
  onFile,
}: {
  pending: boolean;
  skipped: { title: string; error: string }[];
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept=".bib,.ris,.enw,.txt"
        className="sr-only"
        aria-label="选择 BibTeX 或 RIS 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className="self-start rounded-full px-4 py-2 text-sm font-medium bg-surface-container-high text-on-surface active:scale-95 disabled:opacity-50 border-0 cursor-pointer"
      >
        {pending ? "获取中…" : "选择 BibTeX / RIS 文件"}
      </button>
      <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
        Zotero / EndNote 导出后选择该文件 · 每条按其标识抓取 PDF
      </p>
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
    </div>
  );
}

/** What the queue is doing with everything handed to it. */
function ImportQueue() {
  const streaming = useLibraryEvents();
  const client = useQueryClient();
  const jobs = useQuery({
    queryKey: ["library", "imports"],
    queryFn: ({ signal }) => libraryApi.jobs(signal),
    // Progress arrives on the change stream; polling covers it being down.
    refetchInterval: (query) =>
      !streaming &&
      query.state.data?.jobs.some((job) => job.items.some((item) => ACTIVE.includes(item.status)))
        ? 1000
        : false,
  });
  const retry = useMutation({
    mutationFn: libraryApi.retry,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
    },
  });
  const items = (jobs.data?.jobs ?? []).flatMap((job) => job.items);
  const settled = items.filter((item) => !ACTIVE.includes(item.status)).length;
  // Each paper the queue finishes is in the library from that moment, whether
  // or not the change stream is up to say so.
  const counted = useRef(settled);
  useEffect(() => {
    if (counted.current === settled) return;
    counted.current = settled;
    void client.invalidateQueries({ queryKey: ["library", "browse"] });
    void client.invalidateQueries({ queryKey: ["library", "papers"] });
  }, [settled, client]);
  const recent = (jobs.data?.jobs ?? []).slice(-3).reverse();
  if (!recent.length) return null;
  return (
    <section className="border-t border-outline-variant/10 pt-3">
      <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
        入库流水线
      </h3>
      <div aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-auto">
        {recent.map((job) => (
          <JobRows key={job.id} job={job} pending={retry.isPending} onRetry={retry.mutate} />
        ))}
      </div>
      {retry.error ? <p className="mt-1 text-xs text-error">{retry.error.message}</p> : null}
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
