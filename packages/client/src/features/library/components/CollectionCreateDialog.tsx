import type { LiteratureCollection } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Library, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collectionUrl, libraryApi } from "../../../core/library";
import { newSessionUrl } from "../../../core/sessions";
import { Dialog } from "../../../shared/ui/Dialog";
import { collectionNameProblem } from "../collectionName";
import { LibrarySearchBar, type SearchMode } from "./LibrarySearchBar";
import { ImportProgress } from "./import/ImportProgress";
import { ImportStaging, type Staged } from "./import/sources";
import { useImportSubmission } from "./import/submit";

/**
 * Creating a workspace, with the literature that belongs in it.
 *
 * Papers already in the library join at once. Papers imported from here join
 * as the queue finishes each one, and the dialog follows them through the
 * pipeline until the user leaves; the workspace's own page carries on from
 * there. With nothing to import, creating goes straight to a first chat.
 */
export function CollectionCreateDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const sources = usePaperSources();
  const submission = useImportSubmission();
  const [created, setCreated] = useState<LiteratureCollection | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const project = await libraryApi.createCollection(name.trim());
      if (sources.picked.size)
        await libraryApi.collectionPapers(project.id, [...sources.picked], "add");
      return project;
    },
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ["library"] });
      if (!sources.staged.length) {
        onClose();
        navigate(collectionUrl(project.id));
        return;
      }
      setCreated(project);
      void submission.submit(sources.staged, project.id);
    },
  });

  const problem = collectionNameProblem(name);
  // Said once there is something to judge: an empty box is not yet a mistake.
  const shownProblem = attempted || name ? problem : null;
  const submit = () => {
    setAttempted(true);
    if (!problem && !create.isPending) create.mutate();
  };

  return (
    <Dialog
      wide
      tall
      title={created ? `文献集合「${created.name}」` : "新建文献集合"}
      onClose={onClose}
    >
      {created ? (
        <ImportFollowUp
          project={created}
          joined={sources.picked.size}
          submission={submission}
          onClose={onClose}
        />
      ) : (
        // Not a form: the searches inside take Enter for themselves.
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <label className="flex shrink-0 flex-col gap-1.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
              名称
            </span>
            <input
              name="workspace-name"
              aria-label="文献集合名称"
              autoComplete="off"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="例如 湍流减阻综述"
              aria-invalid={Boolean(shownProblem)}
              className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
            />
            {/* The line is always there, so a message appearing never moves the form. */}
            <span role="alert" className="min-h-4 text-xs leading-4 text-error">
              {shownProblem}
            </span>
          </label>

          <PaperSources sources={sources} />

          {create.error ? (
            <p role="alert" className="shrink-0 text-xs text-error break-words">
              {create.error.message}
            </p>
          ) : null}

          <div className="flex shrink-0 items-center gap-3 border-t border-outline-variant/10 pt-3">
            <span className="text-xs text-on-surface-variant">{sources.summary}</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={submit}
              disabled={create.isPending || Boolean(problem)}
              className="btn-primary px-4 py-2 text-sm"
            >
              {create.isPending ? "创建中…" : sources.staged.length ? "创建并导入" : "创建"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Adding literature to a workspace that already exists, from its own page. */
export function CollectionAddPapersDialog({
  project,
  onClose,
}: {
  project: LiteratureCollection;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const sources = usePaperSources(project.paperIds);
  const submission = useImportSubmission();
  const [sent, setSent] = useState(false);
  const add = useMutation({
    mutationFn: async () => {
      if (sources.picked.size)
        await libraryApi.collectionPapers(project.id, [...sources.picked], "add");
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["library"] });
      if (!sources.staged.length) {
        onClose();
        return;
      }
      setSent(true);
      void submission.submit(sources.staged, project.id);
    },
  });
  return (
    <Dialog wide tall title={`加入文献 · ${project.name}`} onClose={onClose}>
      {sent ? (
        <ImportFollowUp
          project={project}
          joined={sources.picked.size}
          submission={submission}
          onClose={onClose}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <PaperSources sources={sources} />
          {add.error ? (
            <p role="alert" className="shrink-0 text-xs text-error break-words">
              {add.error.message}
            </p>
          ) : null}
          <div className="flex shrink-0 items-center gap-3 border-t border-outline-variant/10 pt-3">
            <span className="text-xs text-on-surface-variant">{sources.summary}</span>
            <div className="flex-1" />
            <button
              type="button"
              disabled={add.isPending || sources.empty}
              onClick={() => add.mutate()}
              className="btn-primary px-4 py-2 text-sm"
            >
              {add.isPending ? "加入中…" : "加入文献集合"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** After the queue has the imports: where they are, and where to go next. */
function ImportFollowUp({
  project,
  joined,
  submission,
  onClose,
}: {
  project: LiteratureCollection;
  joined: number;
  submission: ReturnType<typeof useImportSubmission>;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="flex shrink-0 items-center gap-2 text-sm text-on-surface">
        <CheckCircle2 className="w-4 h-4 text-primary" aria-hidden="true" />
        {joined ? `已加入 ${joined} 篇库内文献；` : ""}
        外部文献入库后会自动加入本文献集合。
      </p>
      <div className="flex min-h-0 flex-1 flex-col">
        <ImportProgress submission={submission} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-outline-variant/10 pt-3">
        <span className="text-xs text-on-surface-variant">关闭后导入在后台继续</span>
        <div className="flex-1" />
        <Link
          to={collectionUrl(project.id)}
          onClick={onClose}
          className="btn-pill px-4 py-2 text-sm"
        >
          查看文献集合
        </Link>
        <Link
          to={newSessionUrl({ references: [{ kind: "collection", id: project.id }] })}
          onClick={onClose}
          className="btn-primary px-4 py-2 text-sm"
        >
          在会话中引用
        </Link>
      </div>
    </div>
  );
}

type SourceTab = "library" | "external";

/** What the user has chosen so far, from the library and from outside it. */
function usePaperSources(members: string[] = []) {
  const [tab, setTab] = useState<SourceTab>("library");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<Staged[]>([]);
  const memberSet = useMemo(() => new Set(members), [members]);
  const toggle = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickAll = (ids: string[]) =>
    setPicked((previous) => new Set([...previous, ...ids.filter((id) => !memberSet.has(id))]));
  const parts = [
    picked.size ? `库内 ${picked.size} 篇` : "",
    staged.length ? `待导入 ${staged.length} 篇` : "",
  ].filter(Boolean);
  return {
    tab,
    setTab,
    picked,
    toggle,
    pickAll,
    clearPicked: () => setPicked(new Set()),
    staged,
    setStaged,
    members: memberSet,
    empty: picked.size === 0 && staged.length === 0,
    summary: parts.length ? `已选 ${parts.join(" · ")}` : "可以先不选，稍后在文献集合中加入",
  };
}

type PaperSourcesState = ReturnType<typeof usePaperSources>;

function PaperSources({ sources }: { sources: PaperSourcesState }) {
  const tabs: { id: SourceTab; label: string; count: number }[] = [
    { id: "library", label: "文献库", count: sources.picked.size },
    { id: "external", label: "外部导入", count: sources.staged.length },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
          加入文献
        </span>
        <div
          role="tablist"
          aria-label="文献来源"
          className="inline-flex rounded-full bg-surface-container p-0.5"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={sources.tab === tab.id}
              onClick={() => sources.setTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                sources.tab === tab.id
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab.label}
              {tab.count ? (
                <span className="rounded bg-primary/10 px-1.5 text-[10px] font-mono font-bold leading-4 text-primary">
                  {tab.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {/* Both stay mounted, so switching keeps a half-typed search and its results. */}
      <div
        role="tabpanel"
        hidden={sources.tab !== "library"}
        className="min-h-0 flex-1 flex-col data-[shown=true]:flex"
        data-shown={sources.tab === "library"}
      >
        <InternalPicker sources={sources} />
      </div>
      <div
        role="tabpanel"
        hidden={sources.tab !== "external"}
        className="min-h-0 flex-1 flex-col data-[shown=true]:flex"
        data-shown={sources.tab === "external"}
      >
        <ImportStaging
          staged={sources.staged}
          onAdd={(entries) => sources.setStaged((previous) => [...previous, ...entries])}
          onDrop={(id) =>
            sources.setStaged((previous) => previous.filter((item) => item.id !== id))
          }
          onClear={() => sources.setStaged([])}
          held={{ picked: sources.picked, onPick: sources.toggle }}
        />
      </div>
    </div>
  );
}

const SEARCH_LIMIT = 100;

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** The papers already in the library, found by keyword, meaning or both. */
function InternalPicker({ sources }: { sources: PaperSourcesState }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const query = useDebounced(text.trim(), 350);

  const all = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    select: (data) =>
      data.papers.map((paper) => ({
        id: paper.id,
        title: paper.title,
        meta: [paper.authors, paper.year].filter(Boolean).join(" · "),
      })),
  });
  const found = useQuery({
    queryKey: ["library", "search", { picker: true, query, mode, limit: SEARCH_LIMIT }],
    queryFn: ({ signal }) => libraryApi.search({ query, mode, limit: SEARCH_LIMIT }, signal),
    enabled: Boolean(query),
    staleTime: 60_000,
  });

  const rows = query
    ? (found.data?.results ?? []).map(({ paper }) => ({
        id: paper.id,
        title: paper.title,
        meta: [paper.authors, paper.year || ""].filter(Boolean).join(" · "),
      }))
    : (all.data ?? []);
  const loading = query ? found.isFetching && !found.data : all.isLoading;
  const selectable = rows.filter((row) => !sources.members.has(row.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <LibrarySearchBar
        size="compact"
        label="检索文献库"
        className="shrink-0 rounded-xl border border-outline-variant/20 bg-surface-container focus-within:ring-2 focus-within:ring-primary/20"
        mode={mode}
        onModeChange={setMode}
        text={text}
        onTextChange={setText}
        leading={
          <Search
            className="ml-2.5 w-3.5 h-3.5 shrink-0 text-on-surface-variant"
            aria-hidden="true"
          />
        }
        trailing={
          found.isFetching ? (
            <Loader2 className="mr-3 w-3.5 h-3.5 animate-spin text-primary" aria-hidden="true" />
          ) : text ? (
            <button
              type="button"
              aria-label="清空检索"
              onClick={() => setText("")}
              className="btn-ghost mr-2 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null
        }
      />

      <div className="flex shrink-0 items-center gap-2 text-[11px] text-on-surface-variant">
        <span>{query ? `找到 ${rows.length} 篇` : `文献库共 ${rows.length} 篇`}</span>
        {found.data?.notice ? <span className="truncate">· {found.data.notice}</span> : null}
        <div className="flex-1" />
        {selectable.length ? (
          <button
            type="button"
            onClick={() => sources.pickAll(selectable.map((row) => row.id))}
            className="font-mono text-[10px] font-bold text-primary hover:underline"
          >
            全选{query ? "结果" : ""}
          </button>
        ) : null}
        {sources.picked.size ? (
          <button
            type="button"
            onClick={sources.clearPicked}
            className="font-mono text-[10px] font-bold text-on-surface-variant hover:text-error"
          >
            清除已选
          </button>
        ) : null}
      </div>

      {found.data?.unavailable ? (
        <p className="shrink-0 rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
          语义检索尚未就绪：需要先为文献生成向量。
          <Link className="ml-1 text-primary" to="/library/insights">
            去准备
          </Link>
        </p>
      ) : null}
      {found.error ? (
        <p role="alert" className="shrink-0 text-xs text-error">
          {found.error.message}
        </p>
      ) : null}

      <ul className="min-h-0 flex-1 divide-y divide-outline-variant/10 overflow-auto rounded-xl border border-outline-variant/10">
        {loading ? (
          <li className="flex items-center gap-2 px-3 py-3 text-xs text-on-surface-variant">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            加载中…
          </li>
        ) : null}
        {!loading && rows.length === 0 ? (
          <li className="flex flex-col items-center gap-1 px-3 py-6 text-center text-xs text-on-surface-variant">
            <Library className="w-4 h-4 text-on-surface-variant/50" aria-hidden="true" />
            {query
              ? "没有匹配的文献，换个检索方式试试。"
              : "文献库还是空的，可以先切到「外部导入」。"}
          </li>
        ) : null}
        {rows.map((paper) => {
          const member = sources.members.has(paper.id);
          const checked = member || sources.picked.has(paper.id);
          return (
            <li key={paper.id}>
              <button
                type="button"
                aria-pressed={checked}
                disabled={member}
                onClick={() => sources.toggle(paper.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  checked ? "bg-primary/5" : "hover:bg-surface-container-low"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    checked
                      ? "border-primary bg-primary text-on-primary"
                      : "border-outline-variant/60"
                  }`}
                  aria-hidden="true"
                >
                  {checked ? <Check className="w-3 h-3" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-on-surface">
                    {paper.title}
                  </span>
                  {paper.meta ? (
                    <span className="block truncate text-[11px] text-on-surface-variant">
                      {paper.meta}
                    </span>
                  ) : null}
                </span>
                {member ? (
                  <span className="shrink-0 text-[10px] font-mono text-on-surface-variant">
                    已在其中
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
