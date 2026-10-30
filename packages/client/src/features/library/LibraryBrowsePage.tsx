import { useQuery } from "@tanstack/react-query";
import { CheckSquare, ChevronDown, Search, SortAsc, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi } from "../../core/library";
import { usePageTitle } from "../../shared/layout";
import { useDismiss } from "../../shared/ui/useDismiss";
import { CapabilityPrompt } from "./components/CapabilityPrompt";
import { PaperDetailPanel } from "./components/PaperDetailPanel";
import { PaperResults, ViewModeToggle, useViewMode } from "./components/PaperResults";
import { SearchSkeleton } from "./components/SearchSkeleton";
import { type PaperSort, libraryPapersQuery, sortPapers, toPaperSummary } from "./paperSummary";
import type { PaperSummary } from "./paperSummary";
import { useLibrarySelection } from "./selection";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_SORT_OPTIONS = ["相关度", "年份", "引用量"];
const BROWSE_SORT_OPTIONS = ["年份", "引用量", "标题"];
const BROWSE_SORT_KEYS: PaperSort[] = ["year_desc", "citations_desc", "title_asc"];
const SEARCH_LIMIT = 100;

interface SearchMode {
  id: string;
  label: string;
}
const SEARCH_MODES: SearchMode[] = [
  { id: "unified", label: "综合" },
  { id: "keyword", label: "关键词" },
  { id: "semantic", label: "语义" },
  { id: "author", label: "作者" },
];
const DEFAULT_SEARCH_MODE = SEARCH_MODES[0] ?? { id: "unified", label: "综合" };

interface SubmittedSearch {
  query: string;
  mode: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LibraryBrowsePage() {
  const { setTitle } = usePageTitle();
  const selection = useLibrarySelection();

  // ── Shared view state ──
  const [viewParams, setViewParams] = useSearchParams();
  const [view, setView] = useViewMode();

  // ── Unified sort state ──
  const browseSort = Math.max(0, Math.min(2, Number(viewParams.get("sort")) || 0));
  const searchSort = Math.max(0, Math.min(2, Number(viewParams.get("searchSort")) || 0));
  const saveSort = (key: string, value: number) =>
    setViewParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, String(value));
      return next;
    });
  const setBrowseSort = (value: number) => saveSort("sort", value);
  const setSearchSort = (value: number) => saveSort("searchSort", value);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // ── Browse query ──
  const sort = BROWSE_SORT_KEYS[browseSort] ?? "year_desc";
  const browseQuery = useQuery(libraryPapersQuery);
  const browseLoading = browseQuery.isLoading;
  const browsePapers = useMemo(
    () => sortPapers(browseQuery.data ?? [], sort),
    [browseQuery.data, sort],
  );

  // ── Search state (persisted in URL so back-navigation restores results) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const urlMode = searchParams.get("mode") ?? "unified";

  const [query, setQuery] = useState(urlQuery);
  const [mode, setMode] = useState(urlMode);
  const [modeOpen, setModeOpen] = useState(false);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(
    urlQuery ? { query: urlQuery, mode: urlMode } : null,
  );
  const searched = submittedSearch !== null;
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(urlQuery);
    setMode(urlMode);
    setSubmittedSearch(urlQuery ? { query: urlQuery, mode: urlMode } : null);
  }, [urlQuery, urlMode]);

  // ── Paper drawer ──
  const [selectedPaper, setSelectedPaper] = useState<PaperSummary | null>(null);

  // ── Multi-select state ──
  // The selection itself lives above the library views, so papers picked here
  // stay picked while the user moves to another view to act on them. Only the
  // toolbar's on/off toggle is local; a selection made elsewhere turns it on.
  // A new query does not clear it.
  const [picking, setPicking] = useState(false);
  const selectionMode = picking || selection.selected.size > 0;

  const exitSelectionMode = () => {
    setPicking(false);
    selection.clear();
  };

  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

  const searchBody = submittedSearch
    ? { query: submittedSearch.query, mode: submittedSearch.mode, limit: SEARCH_LIMIT }
    : null;
  const searchQuery = useQuery({
    queryKey: searchBody ? ["library", "search", searchBody] : ["library", "search", "idle"],
    queryFn: ({ signal }) => {
      if (!searchBody) throw new Error("Missing search body");
      return libraryApi.search(searchBody, signal);
    },
    enabled: !!searchBody,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const rawResults = useMemo(
    () => (searchQuery.data?.results ?? []).map((result) => toPaperSummary(result.paper)),
    [searchQuery.data],
  );
  const unavailable = searchQuery.data?.unavailable;
  const loading = searched && searchQuery.isFetching;
  const error =
    searchQuery.error instanceof Error
      ? searchQuery.error.message
      : searchQuery.error
        ? "检索失败，请确认文献服务已启动"
        : null;

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSelectedPaper(null);
    setSubmittedSearch({ query: q, mode });
    setSearchParams({ view, q, mode }, { replace: true });
  };

  useDismiss(modeOpen, () => setModeOpen(false), modeRef);
  useDismiss(sortOpen, () => setSortOpen(false), sortRef);

  // ── Sorted search results ──
  // Relevance is the order the library returned them in.
  const searchPapers = useMemo(
    () =>
      searchSort === 1
        ? sortPapers(rawResults, "year_desc")
        : searchSort === 2
          ? sortPapers(rawResults, "citations_desc")
          : rawResults,
    [rawResults, searchSort],
  );

  const currentMode = SEARCH_MODES.find((m) => m.id === mode) ?? DEFAULT_SEARCH_MODE;

  // ── Unified toolbar values ──
  const sortOptions = searched ? SEARCH_SORT_OPTIONS : BROWSE_SORT_OPTIONS;
  const currentSortIndex = searched ? searchSort : browseSort;
  const currentSortLabel = sortOptions[currentSortIndex] ?? sortOptions[0] ?? "";
  const countText = searched
    ? `检索到 ${searchPapers.length}${browsePapers.length > 0 ? `/${browsePapers.length}` : ""} 条文献`
    : `共 ${browsePapers.length} 篇`;

  const handleSortSelect = (i: number) => {
    if (searched) setSearchSort(i);
    else setBrowseSort(i);
    setSortOpen(false);
  };

  // Single click handler shared by grid cards and list rows in both data
  // sources: in selection mode it toggles checked state, otherwise it opens
  // the detail panel.
  const handlePaperClick = (paper: PaperSummary) => {
    if (selectionMode) {
      selection.toggle(paper.id);
    } else {
      setSelectedPaper((prev) => (prev?.id === paper.id ? null : paper));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Search header ── */}
      <header className="shrink-0 pt-5 pb-3 px-6">
        <div className="max-w-3xl mx-auto">
          {/* Search bar */}
          <div className="relative">
            <div className="w-full bg-surface-container-lowest rounded-2xl flex items-center border border-outline-variant/20 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-[background-color,border-color,box-shadow,transform] shadow-sm">
              <div className="relative shrink-0" ref={modeRef}>
                <button
                  type="button"
                  onClick={() => setModeOpen((v) => !v)}
                  className="flex items-center gap-1 pl-4 pr-3 py-3 text-xs font-mono font-bold text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  {currentMode.label}
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-150 ${modeOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {modeOpen && (
                  <div className="absolute left-0 top-[calc(100%+6px)] z-30 bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-1.5 w-28 shadow-xl">
                    {SEARCH_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMode(m.id);
                          setModeOpen(false);
                          if (searched) {
                            setSearchParams(
                              (prev) => {
                                const next = new URLSearchParams(prev);
                                next.set("mode", m.id);
                                return next;
                              },
                              { replace: true },
                            );
                          }
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors font-mono font-bold ${
                          m.id === mode
                            ? "bg-primary/10 text-primary"
                            : "text-on-surface hover:bg-surface-container"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-4 w-px bg-outline-variant/30 shrink-0" />

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="检索文献"
                name="query"
                // The browser's saved-entry fill paints the field blue; the history it offers is not ours.
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229)
                    handleSearch();
                }}
                placeholder="输入并搜索…"
                className="min-w-0 flex-1 bg-transparent text-on-surface px-3 py-3 font-sans text-sm outline-none placeholder:text-on-surface-variant/40"
              />

              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSubmittedSearch(null);
                    setSelectedPaper(null);
                    setSearchParams({ view }, { replace: true });
                  }}
                  aria-label="清空检索"
                  className="mr-3 p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {mode === "semantic" && !searched ? (
              // Once a query has run, the results area carries this instead.
              <div className="mt-3">
                <CapabilityPrompt kind="semantic" hideWhenReady />
              </div>
            ) : null}

            {loading && (
              <div className="absolute -bottom-2.5 inset-x-0 h-0.5 rounded-full overflow-hidden bg-outline-variant/10">
                <div
                  className="h-full bg-primary animate-search-progress"
                  style={{ width: "40%" }}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Unified toolbar (always visible, same layout in all states) ── */}
      <div
        className="shrink-0 flex flex-wrap gap-2 items-center justify-between px-6 mb-4"
        ref={sortRef}
      >
        {selectionMode ? (
          <>
            {/* Selection mode: picking papers. The actions live in the
                selection bar at the bottom, which every library view shares. */}
            <p className="text-sm text-on-surface-variant">
              {selection.selected.size
                ? `已选 ${selection.selected.size} 篇 · 在下方操作栏中处理`
                : "点击文献以选择"}
            </p>
            <button
              type="button"
              onClick={exitSelectionMode}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high border-0 bg-transparent cursor-pointer"
              aria-label="退出选择"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {/* Left: sort pill + divider + count */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSortOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high rounded-full text-sm font-medium text-primary hover:bg-surface-container active:scale-95 transition-[background-color,border-color,box-shadow,transform]"
                >
                  <SortAsc className="w-3.5 h-3.5" />
                  {currentSortLabel}
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${sortOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {sortOpen && (
                  <div className="absolute top-9 left-0 z-20 w-36 bg-surface-container-high border border-outline-variant/20 rounded-xl p-1.5 shadow-xl">
                    {sortOptions.map((opt, i) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleSortSelect(i)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          i === currentSortIndex
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-on-surface hover:bg-surface-container"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="h-4 w-px bg-outline-variant/30" />
              <p className="text-sm text-on-surface-variant font-sans">{countText}</p>
            </div>

            {/* Right: select + view toggle */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPicking(true);
                  setSelectedPaper(null);
                }}
                title="多选"
                aria-label="多选"
                className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high border-0 bg-transparent cursor-pointer"
              >
                <CheckSquare className="w-4 h-4" />
              </button>
              <div className="h-4 w-px bg-outline-variant/30 mx-1" />
              <ViewModeToggle view={view} onChange={setView} buttonClassName="p-1.5 rounded-lg" />
            </div>
          </>
        )}
      </div>

      {browseQuery.error ? (
        <p role="alert" className="px-6 text-sm text-error">
          {browseQuery.error.message}
        </p>
      ) : null}
      {searchQuery.data?.notice ? (
        <output className="px-6 pb-2 text-xs text-on-surface-variant">
          {searchQuery.data.notice}
        </output>
      ) : null}
      {/* ── Body ── */}
      {!searched ? (
        /* ── Browse mode ── */
        <div className="flex-1 flex flex-col min-h-0 px-6 pb-4">
          {browseLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-on-surface-variant">
              加载中…
            </div>
          ) : browsePapers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
                <Search className="w-5 h-5 text-on-surface-variant/40" />
              </div>
              <p className="text-sm text-on-surface-variant">
                文献库还是空的。
                <Link className="text-primary" to="/library?import=1">
                  导入第一篇
                </Link>
                ：拖入 PDF、按 DOI 获取，或从 Zotero 导出文件导入。
              </p>
            </div>
          ) : (
            <PaperResults
              view={view}
              papers={browsePapers}
              selectedId={selectedPaper?.id}
              onSelect={handlePaperClick}
              selectionMode={selectionMode}
              checkedIds={selection.selected}
              addedMap={selection.added}
            />
          )}
        </div>
      ) : loading ? (
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <SearchSkeleton view={view} />
        </div>
      ) : (
        /* ── Search results ── */
        <div className="flex-1 flex flex-col min-h-0 px-6 pb-4">
          {error && (
            <div className="shrink-0 rounded-xl bg-error-container/10 border border-error/20 p-4 text-sm text-error mb-4">
              {error}
            </div>
          )}

          {searchPapers.length === 0 ? (
            unavailable ? (
              // The mode could not run at all. The card says why and fixes it.
              <div className="flex-1 flex items-center justify-center">
                <div className="w-full max-w-sm">
                  <CapabilityPrompt kind="semantic" explain />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-on-surface mb-1">无结果</p>
                <p className="text-xs text-on-surface-variant">尝试更换检索词或切换检索模式</p>
              </div>
            )
          ) : (
            <PaperResults
              view={view}
              papers={searchPapers}
              listKey={submittedSearch?.query}
              selectedId={selectedPaper?.id}
              onSelect={handlePaperClick}
              selectionMode={selectionMode}
              checkedIds={selection.selected}
              addedMap={selection.added}
            />
          )}
        </div>
      )}

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaper(null)} />
    </div>
  );
}
