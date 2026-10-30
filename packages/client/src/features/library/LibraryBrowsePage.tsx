import { useQuery } from "@tanstack/react-query";
import { CheckSquare, ChevronDown, Search, SortAsc, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { libraryApi } from "../../core/library";
import { usePageTitle } from "../../shared/layout";
import { ChoiceMenu } from "../../shared/ui/Menu";
import { CapabilityPrompt } from "./components/CapabilityPrompt";
import { LibrarySearchBar, type SearchMode, searchMode } from "./components/LibrarySearchBar";
import { PaperDetailPanel } from "./components/PaperDetailPanel";
import { PaperResults, ViewModeToggle, useViewMode } from "./components/PaperResults";
import { SearchSkeleton } from "./components/SearchSkeleton";
import {
  PAPER_SORTS,
  RESULT_SORTS,
  SORT_LABELS,
  libraryPapersQuery,
  sortPapers,
  toPaperSummary,
} from "./paperSummary";
import type { PaperSummary } from "./paperSummary";
import { useLibrarySelection } from "./selection";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_LIMIT = 100;

interface SubmittedSearch {
  query: string;
  mode: SearchMode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LibraryBrowsePage() {
  const { setTitle } = usePageTitle();
  const selection = useLibrarySelection();

  // ── Shared view state ──
  const [viewParams, setViewParams] = useSearchParams();
  const [view, setView] = useViewMode();

  // ── Unified sort state ──
  const browseSort = Math.max(
    0,
    Math.min(PAPER_SORTS.length - 1, Number(viewParams.get("sort")) || 0),
  );
  const searchSort = Math.max(
    0,
    Math.min(RESULT_SORTS.length - 1, Number(viewParams.get("searchSort")) || 0),
  );
  const saveSort = (key: string, value: number) =>
    setViewParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, String(value));
      return next;
    });
  const setBrowseSort = (value: number) => saveSort("sort", value);
  const setSearchSort = (value: number) => saveSort("searchSort", value);

  // ── Browse query ──
  const sort = PAPER_SORTS[browseSort] ?? "year_desc";
  const browseQuery = useQuery(libraryPapersQuery);
  const browseLoading = browseQuery.isLoading;
  const browsePapers = useMemo(
    () => sortPapers(browseQuery.data ?? [], sort),
    [browseQuery.data, sort],
  );

  // ── Search state (persisted in URL so back-navigation restores results) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const urlMode = searchMode(searchParams.get("mode"), "unified");

  const [query, setQuery] = useState(urlQuery);
  const [mode, setMode] = useState(urlMode);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(
    urlQuery ? { query: urlQuery, mode: urlMode } : null,
  );
  const searched = submittedSearch !== null;

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

  // ── Sorted search results ──
  const searchPapers = useMemo(
    () => sortPapers(rawResults, RESULT_SORTS[searchSort] ?? "relevance"),
    [rawResults, searchSort],
  );

  // ── Unified toolbar values ──
  const sortOptions = (searched ? RESULT_SORTS : PAPER_SORTS).map((key) => SORT_LABELS[key]);
  const currentSortIndex = searched ? searchSort : browseSort;
  const currentSortLabel = sortOptions[currentSortIndex] ?? sortOptions[0] ?? "";
  const countText = searched
    ? `检索到 ${searchPapers.length}${browsePapers.length > 0 ? `/${browsePapers.length}` : ""} 条文献`
    : `共 ${browsePapers.length} 篇`;

  const handleSortSelect = (i: number) => {
    if (searched) setSearchSort(i);
    else setBrowseSort(i);
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
            <LibrarySearchBar
              size="large"
              label="检索文献"
              className="w-full bg-surface-container-lowest rounded-2xl border border-outline-variant/20 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-[background-color,border-color,box-shadow] shadow-sm"
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                if (searched)
                  setSearchParams(
                    (prev) => {
                      const params = new URLSearchParams(prev);
                      params.set("mode", next);
                      return params;
                    },
                    { replace: true },
                  );
              }}
              text={query}
              onTextChange={setQuery}
              onSubmit={handleSearch}
              trailing={
                query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSubmittedSearch(null);
                      setSelectedPaper(null);
                      setSearchParams({ view }, { replace: true });
                    }}
                    aria-label="清空检索"
                    className="btn-ghost mr-3 p-1 rounded-lg hover:text-on-surface"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null
              }
            />

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
      <div className="shrink-0 flex flex-wrap gap-2 items-center justify-between px-6 mb-4">
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
              className="btn-ghost p-1.5 rounded-lg"
              aria-label="退出选择"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {/* Left: sort pill + divider + count */}
            <div className="flex items-center gap-3">
              <ChoiceMenu
                triggerTitle="排序"
                triggerClassName="btn-pill px-3 py-1.5 text-sm text-primary"
                panelClassName="w-36"
                trigger={(open) => (
                  <>
                    <SortAsc className="w-3.5 h-3.5" />
                    {currentSortLabel}
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </>
                )}
                sections={[
                  {
                    selected: String(currentSortIndex),
                    onSelect: (id) => handleSortSelect(Number(id)),
                    items: sortOptions.map((label, i) => ({ id: String(i), label })),
                  },
                ]}
              />
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
                className="btn-ghost p-1.5 rounded-lg"
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
