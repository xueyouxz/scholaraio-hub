import type { DiscoveredPaper } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, FileText, FolderPlus, Globe, Loader2, Plus, Search, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { libraryApi } from "../../../../core/library";
import { formatBytes } from "../../../../shared/format";
import { type RejectedFile, locatorIn, looksLikePdf, screenFiles } from "./localFiles";
import type { Staged } from "./submit";

export type { Staged } from "./submit";

/**
 * Choosing papers to import: searched for on the web, or picked from disk.
 *
 * Both land in one list below, which is what will be imported. Choosing is not
 * importing — every entry stays removable until the owner of the list hands it
 * to the queue.
 */
export function ImportStaging({
  staged,
  onAdd,
  onDrop,
  onClear,
  held,
}: {
  staged: Staged[];
  onAdd: (entries: Staged[]) => void;
  onDrop: (id: string) => void;
  onClear: () => void;
  /** Results the library already holds: how to pick them instead of fetching again. */
  held?: { picked: ReadonlySet<string>; onPick: (paperId: string) => void };
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [checking, setChecking] = useState(0);
  const known = useMemo(
    () => new Set(staged.flatMap((entry) => (entry.kind === "file" ? [entry.id] : []))),
    [staged],
  );
  const stagedLocators = useMemo(
    () => new Set(staged.flatMap((entry) => (entry.kind === "locator" ? [entry.locator] : []))),
    [staged],
  );

  const accept = async (list: FileList | null) => {
    const { accepted, rejected: refused } = screenFiles(Array.from(list ?? []), known);
    setRejected((previous) => [...previous, ...refused]);
    if (!accepted.length) return;
    setChecking((count) => count + accepted.length);
    try {
      const checked = await Promise.all(
        accepted.map(async (candidate) => ({
          candidate,
          pdf: await looksLikePdf(candidate.file).catch(() => false),
        })),
      );
      setRejected((previous) => [
        ...previous,
        ...checked
          .filter((entry) => !entry.pdf)
          .map((entry) => ({ path: entry.candidate.path, reason: "内容不是 PDF" })),
      ]);
      onAdd(
        checked
          .filter((entry) => entry.pdf)
          .map(({ candidate }) => ({
            kind: "file" as const,
            id: candidate.key,
            name: candidate.file.name,
            path: candidate.path,
            file: candidate.file,
          })),
      );
    } finally {
      setChecking((count) => count - accepted.length);
    }
  };

  const addLocator = (locator: string, name = locator, detail?: string) => {
    if (stagedLocators.has(locator)) return;
    onAdd([{ kind: "locator", id: `locator:${locator}`, name, locator, detail }]);
  };

  const bytes = staged.reduce(
    (sum, entry) => sum + (entry.kind === "file" ? entry.file.size : 0),
    0,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        {/* Not a form: this list is often inside one, and Enter here only searches. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-1.5 focus-within:ring-2 focus-within:ring-primary/20">
          <Globe className="w-3.5 h-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
          <input
            name="discover"
            aria-label="在网络上检索文献"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              setSubmitted(query.trim());
            }}
            placeholder="检索网络文献：标题、主题、作者、DOI 或 arXiv 编号"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/50"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空检索"
              onClick={() => {
                setQuery("");
                setSubmitted("");
              }}
              className="rounded-full p-0.5 text-on-surface-variant hover:bg-surface-container-high"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="检索"
            disabled={!query.trim()}
            onClick={() => setSubmitted(query.trim())}
            className="rounded-full p-1 text-primary hover:bg-primary/10"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
        <LocalPicker onPick={accept} />
      </div>

      {submitted ? (
        <WebResults
          query={submitted}
          staged={stagedLocators}
          held={held}
          onAdd={addLocator}
          onClose={() => setSubmitted("")}
        />
      ) : null}

      {checking > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          正在识别 {checking} 个文件…
        </p>
      ) : null}
      {rejected.length ? (
        <details className="rounded-lg bg-surface-container-low px-3 py-1.5 text-xs text-on-surface-variant">
          <summary className="cursor-pointer select-none">
            已忽略 {rejected.length} 个文件
            <button
              type="button"
              onClick={() => setRejected([])}
              className="ml-2 text-[10px] font-mono font-bold text-on-surface-variant/70 hover:text-on-surface"
            >
              清除
            </button>
          </summary>
          <ul className="mt-1 max-h-24 overflow-auto">
            {rejected.map((entry, index) => (
              <li key={`${entry.path}:${index}`} className="flex gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                <span className="shrink-0 font-mono text-[10px]">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="flex min-h-24 flex-[2_1_0%] flex-col gap-1.5" aria-label="待导入">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            待导入 {staged.length}
          </h3>
          {bytes ? (
            <span className="text-[10px] font-mono text-on-surface-variant/70">
              {formatBytes(bytes)}
            </span>
          ) : null}
          <div className="flex-1" />
          {staged.length ? (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-mono font-bold text-on-surface-variant hover:text-error"
            >
              清空
            </button>
          ) : null}
        </div>
        {staged.length === 0 ? (
          <p className="rounded-lg border border-dashed border-outline-variant/30 px-3 py-4 text-center text-xs text-on-surface-variant/70">
            检索网络文献后点「+」加入，或添加本地 PDF 与文件夹（可多次、混合选择）。
          </p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-1 overflow-auto">
            {staged.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-1.5"
              >
                {entry.kind === "locator" ? (
                  <Globe
                    className="w-3.5 h-3.5 shrink-0 text-on-surface-variant"
                    aria-hidden="true"
                  />
                ) : (
                  <FileText
                    className="w-3.5 h-3.5 shrink-0 text-on-surface-variant"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-on-surface">{entry.name}</span>
                  <span className="block truncate text-[10px] font-mono text-on-surface-variant/70">
                    {entry.kind === "file"
                      ? `${entry.path} · ${formatBytes(entry.file.size)}`
                      : (entry.detail ?? entry.locator)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${entry.name}`}
                  onClick={() => onDrop(entry.id)}
                  className="btn-ghost p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * PDFs and folders from disk, as many times and in any mix the user likes.
 *
 * The platform picker chooses either files or one folder per opening, so
 * there are two openings; what they return lands in the same list.
 */
function LocalPicker({ onPick }: { onPick: (list: FileList | null) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  const button =
    "inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-container-highest active:scale-95";
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="选择 PDF 文件"
        onChange={(event) => {
          onPick(event.target.files);
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
          onPick(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className={button}
        title="添加 PDF 文件，可多选"
      >
        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
        PDF
      </button>
      <button
        type="button"
        onClick={() => folderInput.current?.click()}
        className={button}
        title="添加文件夹，包含其中所有 PDF"
      >
        <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
        文件夹
      </button>
    </>
  );
}

function describe(paper: DiscoveredPaper): string {
  const authors =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} 等`
      : paper.authors.join(", ");
  return [authors, paper.venue, paper.year].filter(Boolean).join(" · ");
}

/** What the open web has for the submitted query, each result one click from the list. */
function WebResults({
  query,
  staged,
  held,
  onAdd,
  onClose,
}: {
  query: string;
  staged: ReadonlySet<string>;
  held?: { picked: ReadonlySet<string>; onPick: (paperId: string) => void };
  onAdd: (locator: string, name?: string, detail?: string) => void;
  onClose: () => void;
}) {
  const results = useQuery({
    queryKey: ["library", "discover", query],
    queryFn: ({ signal }) => libraryApi.discover(query, signal),
    staleTime: 5 * 60_000,
  });
  const direct = locatorIn(query);
  const rows = results.data?.results ?? [];
  return (
    <section
      aria-label="网络检索结果"
      className="flex min-h-0 flex-[3_1_0%] flex-col rounded-xl border border-outline-variant/15 bg-surface-container-lowest"
    >
      <div className="flex items-center gap-2 border-b border-outline-variant/10 px-3 py-1.5">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          网络检索
        </span>
        <span className="text-[10px] font-mono text-on-surface-variant/70">
          {results.isFetching ? "检索中…" : `${rows.length} 条 · OpenAlex + arXiv`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="收起检索结果"
          onClick={onClose}
          className="rounded-full p-0.5 text-on-surface-variant hover:bg-surface-container-high"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-outline-variant/10 overflow-auto">
        {direct ? (
          <ResultRow
            title={`按标识获取：${direct}`}
            detail="直接下载该 DOI / arXiv / 链接对应的 PDF"
            added={staged.has(direct)}
            onAdd={() => onAdd(direct)}
          />
        ) : null}
        {results.isLoading ? (
          <li className="flex items-center gap-2 px-3 py-3 text-xs text-on-surface-variant">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            正在检索 OpenAlex 与 arXiv…
          </li>
        ) : null}
        {results.error ? (
          <li role="alert" className="px-3 py-2 text-xs text-error">
            {results.error.message}
          </li>
        ) : null}
        {rows.map((paper) =>
          paper.paperId ? (
            <ResultRow
              key={paper.id}
              title={paper.title}
              detail={describe(paper)}
              badge="已在库中"
              added={held?.picked.has(paper.paperId) ?? false}
              addLabel={held ? "从文献库加入" : undefined}
              onAdd={held ? () => held.onPick(paper.paperId as string) : undefined}
            />
          ) : (
            <ResultRow
              key={paper.id}
              title={paper.title}
              detail={describe(paper)}
              badge={paper.source === "arxiv" ? "arXiv" : paper.openAccess ? "开放获取" : undefined}
              added={staged.has(paper.locator)}
              onAdd={() => onAdd(paper.locator, paper.title, describe(paper))}
            />
          ),
        )}
        {results.data && !rows.length && !direct ? (
          <li className="px-3 py-3 text-xs text-on-surface-variant">
            没有找到相关文献，换个检索词试试。
          </li>
        ) : null}
      </ul>
      {results.data?.errors.length ? (
        <p className="border-t border-outline-variant/10 px-3 py-1 text-[10px] text-on-surface-variant">
          {results.data.errors.map((error) => `${error.source} 暂不可用`).join("，")}
        </p>
      ) : null}
    </section>
  );
}

function ResultRow({
  title,
  detail,
  badge,
  added,
  addLabel = "加入待导入",
  onAdd,
}: {
  title: string;
  detail: string;
  badge?: string;
  added: boolean;
  addLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-on-surface" title={title}>
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          {badge ? (
            <span className="shrink-0 rounded bg-secondary-container/40 px-1.5 py-px text-[9px] font-mono font-bold uppercase leading-none text-secondary">
              {badge}
            </span>
          ) : null}
          <span className="truncate">{detail}</span>
        </span>
      </span>
      {onAdd ? (
        <button
          type="button"
          aria-label={added ? `已加入 ${title}` : `${addLabel} ${title}`}
          title={added ? "已加入" : addLabel}
          disabled={added}
          onClick={onAdd}
          className={`shrink-0 rounded-full p-1.5 ${added ? "text-primary" : "text-on-surface-variant hover:bg-primary/10 hover:text-primary"}`}
        >
          {added ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      ) : null}
    </li>
  );
}
