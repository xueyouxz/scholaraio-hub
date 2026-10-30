import type { ImportJob } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  SortAsc,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collectionUrl, libraryApi, readerUrl } from "../../core/library";
import { newSessionUrl } from "../../core/sessions";
import { usePageTitle } from "../../shared/layout";
import { ChoiceMenu } from "../../shared/ui/Menu";
import { CollectionAddPapersDialog } from "./components/CollectionCreateDialog";
import { LibrarySearchBar, type SearchMode } from "./components/LibrarySearchBar";
import { PaperDetailPanel } from "./components/PaperDetailPanel";
import { PaperResults, ViewModeToggle, useViewMode } from "./components/PaperResults";
import { StepTrack, useImportJobs } from "./components/import/ImportProgress";
import {
  ACTIVE_IMPORT,
  INGESTED_IMPORT,
  type ImportItem,
  PIPELINE_STEPS,
  TONE_TEXT,
  importState,
} from "./components/import/pipeline";
import {
  PAPER_SORTS,
  SORT_LABELS,
  libraryPapersQuery,
  sortPapers,
  toPaperSummary,
} from "./paperSummary";
import type { PaperSummary } from "./paperSummary";

/**
 * One workspace's literature: what is in it, and what is still on its way in.
 *
 * Not the library page scoped down: there is no analysis here and nothing to
 * multi-select. The workspace is a reading list, so the page leads with the
 * papers, keeps search behind an icon, and shows every import headed for this
 * workspace as a card of its own until the paper it becomes takes its place.
 */
export function CollectionPage({ collectionId }: { collectionId: string }) {
  const { setTitle } = usePageTitle();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useViewMode();
  const sortIndex = Math.max(0, Math.min(PAPER_SORTS.length - 1, Number(params.get("sort")) || 0));
  const setParam = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const project = useQuery({
    queryKey: ["library", "collection", collectionId],
    queryFn: ({ signal }) => libraryApi.collection(collectionId, signal),
  });
  useEffect(() => {
    setTitle(project.data?.name ?? collectionId);
    return () => setTitle("");
  }, [setTitle, project.data?.name, collectionId]);

  const sort = PAPER_SORTS[sortIndex] ?? "year_desc";
  // The workspace's papers are the library's, narrowed to its list.
  const library = useQuery(libraryPapersQuery);

  const [searchOpen, setSearchOpen] = useState(false);
  const searchField = useRef<HTMLInputElement>(null);
  // The field opens because the user asked to search, so it takes the focus.
  useEffect(() => {
    if (searchOpen) searchField.current?.focus();
  }, [searchOpen]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [submitted, setSubmitted] = useState<{ query: string; mode: SearchMode } | null>(null);
  const found = useQuery({
    queryKey: ["library", "search", { ...submitted, limit: 200, collectionId }],
    queryFn: ({ signal }) =>
      libraryApi.search(
        {
          query: submitted?.query ?? "",
          mode: submitted?.mode ?? "keyword",
          limit: 200,
          collectionId,
        },
        signal,
      ),
    enabled: Boolean(submitted),
    select: (data) => ({
      ...data,
      papers: data.results.map((result) => toPaperSummary(result.paper)),
    }),
  });
  const closeSearch = () => {
    setSearchOpen(false);
    setText("");
    setSubmitted(null);
  };

  const jobs = useImportJobs(true);
  const papers = useMemo(() => {
    const members = new Set(project.data?.paperIds ?? []);
    return sortPapers(
      (library.data ?? []).filter((paper) => members.has(paper.id)),
      sort,
    );
  }, [library.data, project.data?.paperIds, sort]);
  const inbound = useMemo(
    () => incoming(jobs.data?.jobs ?? [], collectionId, new Set(papers.map((paper) => paper.id))),
    [jobs.data, collectionId, papers],
  );

  const [selected, setSelected] = useState<PaperSummary | null>(null);
  /** Open a paper's details, or close them when it is open already. */
  const toggleSelected = (paper: PaperSummary) =>
    setSelected((previous) => (previous?.id === paper.id ? null : paper));
  const [adding, setAdding] = useState(false);
  const shown = submitted ? (found.data?.papers ?? []) : papers;
  const active = inbound.filter((entry) => ACTIVE_IMPORT.includes(entry.item.status)).length;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-4 pb-3">
        <p className="text-sm text-on-surface-variant">
          {submitted
            ? `找到 ${shown.length} 篇`
            : `${papers.length} 篇文献${active ? ` · ${active} 篇入库中` : ""}`}
        </p>
        {!submitted ? (
          <SortMenu index={sortIndex} onChange={(index) => setParam("sort", String(index))} />
        ) : null}
        <div className="flex-1" />
        {searchOpen ? (
          <LibrarySearchBar
            size="compact"
            label="在文献集合中检索"
            placeholder="检索本文献集合…"
            className="w-full max-w-sm rounded-full border border-outline-variant/20 bg-surface-container-lowest pl-1 focus-within:ring-2 focus-within:ring-primary/20 sm:w-80"
            inputRef={searchField}
            mode={mode}
            onModeChange={(next) => {
              setMode(next);
              if (submitted) setSubmitted({ ...submitted, mode: next });
            }}
            text={text}
            onTextChange={setText}
            onSubmit={() => {
              const query = text.trim();
              setSubmitted(query ? { query, mode } : null);
            }}
            onEscape={closeSearch}
            trailing={
              <>
                {found.isFetching ? (
                  <Loader2
                    className="mr-2 w-3.5 h-3.5 animate-spin text-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label="关闭检索"
                  onClick={closeSearch}
                  className="btn-ghost mr-1 p-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            }
          />
        ) : (
          <button
            type="button"
            aria-label="检索"
            title="检索"
            onClick={() => setSearchOpen(true)}
            className="btn-ghost p-2"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
        <ViewModeToggle view={view} onChange={setView} buttonClassName="rounded-full p-2" />
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!project.data}
          className="btn-pill px-3 py-1.5 text-sm"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          加入文献
        </button>
        <Link
          to={newSessionUrl({ references: [{ kind: "collection", id: collectionId }] })}
          className="btn-primary px-3.5 py-1.5 text-sm"
        >
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          在会话中引用
        </Link>
      </div>

      {(project.error ?? library.error ?? found.error) ? (
        <p role="alert" className="px-6 pb-2 text-sm text-error">
          {(project.error ?? library.error ?? found.error)?.message}
        </p>
      ) : null}
      {found.data?.notice ? (
        <output className="px-6 pb-2 text-xs text-on-surface-variant">{found.data.notice}</output>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
        {library.isLoading || project.isLoading || (submitted && found.isLoading) ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-[7.5rem] rounded-xl skeleton-shimmer opacity-60" />
            ))}
          </div>
        ) : shown.length === 0 && (submitted || inbound.length === 0) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-on-surface-variant">
              {submitted
                ? "没有匹配的文献，换个检索词或检索方式试试。"
                : "这个文献集合还没有文献。"}
            </p>
            {!submitted ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="btn-primary px-4 py-2 text-sm"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                加入文献
              </button>
            ) : null}
          </div>
        ) : (
          <PaperResults
            view={view}
            papers={shown}
            selectedId={selected?.id}
            onSelect={toggleSelected}
            leading={
              submitted
                ? undefined
                : inbound.map((entry) => <IncomingCard key={entry.item.id} entry={entry} />)
            }
            renderCard={(paper) => (
              <CollectionPaperCard
                key={paper.id}
                paper={paper}
                collectionId={collectionId}
                active={selected?.id === paper.id}
                onOpen={() => toggleSelected(paper)}
              />
            )}
          />
        )}
      </div>

      <PaperDetailPanel
        paper={selected}
        collectionId={collectionId}
        onClose={() => setSelected(null)}
      />
      {adding && project.data ? (
        <CollectionAddPapersDialog project={project.data} onClose={() => setAdding(false)} />
      ) : null}
    </div>
  );
}

interface Incoming {
  job: ImportJob;
  item: ImportItem;
}

/**
 * Imports headed for this workspace that are not yet one of its papers.
 *
 * An item stays until its paper shows up in the list, so there is no gap
 * between the card saying "入库" and the paper appearing.
 */
function incoming(
  jobs: ImportJob[],
  collectionId: string,
  present: ReadonlySet<string>,
): Incoming[] {
  return jobs
    .filter((job) => job.collectionId === collectionId)
    .flatMap((job) => job.items.map((item) => ({ job, item })))
    .filter(({ item }) => {
      if (ACTIVE_IMPORT.includes(item.status) || item.status === "failed") return true;
      const held = INGESTED_IMPORT.includes(item.status) || item.status === "duplicate";
      return (
        held && !item.collectionError && Boolean(item.paperId) && !present.has(item.paperId ?? "")
      );
    });
}

/** A file on its way into the workspace, at the pipeline step it has reached. */
function IncomingCard({ entry }: { entry: Incoming }) {
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: libraryApi.retry,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library", "imports"] });
    },
  });
  const { item } = entry;
  const state = importState(item);
  const failed = item.status === "failed";
  const step = Math.min(Math.max(state.reached, 0) + 1, PIPELINE_STEPS.length);
  return (
    <article
      aria-label={`${item.title ?? item.name}：${state.label}`}
      className={`relative flex h-[7.5rem] flex-col overflow-hidden rounded-xl border px-4 py-3 ${
        failed
          ? "border-error/25 bg-error-container/10"
          : "border-outline-variant/15 bg-surface-container-low"
      }`}
    >
      {!failed ? (
        <span
          className="pointer-events-none absolute inset-0 skeleton-shimmer opacity-[0.18]"
          aria-hidden="true"
        />
      ) : null}
      <div className="relative flex items-start gap-2">
        {failed ? null : (
          <Loader2
            className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${item.status === "running" ? "animate-spin text-primary" : "text-on-surface-variant/60"}`}
            aria-hidden="true"
          />
        )}
        <h3 className="line-clamp-2 min-w-0 flex-1 font-serif text-sm font-semibold text-on-surface/80">
          {item.title ?? item.name}
        </h3>
      </div>
      <div className="relative mt-auto flex items-center gap-2">
        <StepTrack item={item} />
        <span className={`text-[10px] font-mono font-bold uppercase ${TONE_TEXT[state.tone]}`}>
          {state.label}
        </span>
        {item.status === "running" ? (
          <span className="text-[10px] font-mono text-on-surface-variant/70">
            {step}/{PIPELINE_STEPS.length}
          </span>
        ) : null}
        <div className="flex-1" />
        {failed ? (
          <button
            type="button"
            onClick={() => retry.mutate(entry.job.id)}
            disabled={
              retry.isPending ||
              entry.job.items.some((other) => ACTIVE_IMPORT.includes(other.status))
            }
            className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-primary"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            重试
          </button>
        ) : null}
      </div>
      {item.error ? (
        <p className="relative mt-1 truncate text-[11px] text-error" title={item.error}>
          {item.error}
        </p>
      ) : null}
    </article>
  );
}

const STATUS_DOT: Record<PaperSummary["status"], { dot: string; label: string }> = {
  ingested: { dot: "bg-primary shadow-[0_0_8px_rgba(26,107,74,0.4)]", label: "已解析" },
  pending: { dot: "bg-tertiary/70", label: "未解析全文" },
  "no-pdf": { dot: "bg-error/70", label: "无 PDF" },
};

/** A paper in the workspace: a reading-list entry rather than a library tile. */
function CollectionPaperCard({
  paper,
  collectionId,
  active,
  onOpen,
}: {
  paper: PaperSummary;
  collectionId: string;
  active: boolean;
  onOpen: () => void;
}) {
  const status = STATUS_DOT[paper.status] ?? STATUS_DOT.pending;
  const reader = readerUrl(paper.id, {
    collectionId,
    returnTo: collectionUrl(collectionId),
  });
  return (
    <article
      className={`group relative flex h-[7.5rem] flex-col rounded-xl border px-4 py-3 transition-[background-color,border-color,box-shadow] ${
        active
          ? "border-primary/25 bg-surface-container-high shadow-md"
          : "border-outline-variant/10 bg-surface-container-low hover:bg-surface-container hover:shadow-md"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={active}
        className="flex min-w-0 items-start gap-2 text-left"
      >
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status.dot}`}
          title={status.label}
          aria-hidden="true"
        />
        <span className="line-clamp-2 min-w-0 flex-1 font-serif text-sm font-semibold text-on-surface group-hover:text-primary">
          {paper.title}
        </span>
      </button>
      <p className="mt-1 truncate pl-4 text-xs text-on-surface-variant">
        {paper.authors || "作者信息暂无"}
      </p>
      <div className="mt-auto flex items-center gap-2 pl-4">
        <span className="min-w-0 truncate text-[10px] font-mono text-on-surface-variant/70">
          {[paper.source, paper.year || null].filter(Boolean).join(" · ") || "来源暂无"}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-on-surface-variant/60">
          {status.label}
        </span>
        <div className="flex-1" />
        <Link
          to={reader}
          className="shrink-0 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          阅读 →
        </Link>
      </div>
    </article>
  );
}

function SortMenu({ index, onChange }: { index: number; onChange: (index: number) => void }) {
  return (
    <ChoiceMenu
      triggerTitle="排序"
      triggerClassName="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"
      panelClassName="w-32"
      trigger={(open) => (
        <>
          <SortAsc className="w-3.5 h-3.5" aria-hidden="true" />
          {SORT_LABELS[PAPER_SORTS[index] ?? "year_desc"]}
          <ChevronDown
            className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </>
      )}
      sections={[
        {
          selected: String(index),
          onSelect: (id) => onChange(Number(id)),
          items: PAPER_SORTS.map((key, i) => ({ id: String(i), label: SORT_LABELS[key] })),
        },
      ]}
    />
  );
}
