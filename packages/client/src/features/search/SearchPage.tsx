import { useQuery } from "@tanstack/react-query";
import { CheckSquare, ChevronDown, LayoutGrid, LayoutList, Search, SortAsc, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import type { ScholarPaper } from "../../core/scholarTypes";
import { PaperDetailPanel } from "../library/components/PaperDetailPanel";
import { PaperGridCard } from "../library/components/PaperGridCard";
import { PaperVirtualList } from "../library/components/PaperVirtualList";
import { toPaperRef } from "../library/paperUtils";
import { useLibrarySelection } from "../library/selection";
import type { PaperReference, ViewMode } from "../library/types";
import { SearchSkeleton } from "./components/SearchSkeleton";
import { searchLibrary as scholar } from "./libraryAdapter";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_SORT_OPTIONS = ["相关度", "年份", "引用量"];
const BROWSE_SORT_OPTIONS = ["年份", "引用量", "标题"];
const BROWSE_SORT_KEYS = ["year_desc", "citations_desc", "title_asc"];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRef(p: ScholarPaper): PaperReference {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    source: p.source,
    year: p.year,
    citations: p.citations,
    status: p.status,
    hasPdf: p.hasPdf,
    hasPdfFile: p.hasPdfFile,
    isIndexed: p.isIndexed,
    abstract: p.abstract,
    coverImage: p.coverImage,
    paperType: p.paperType,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SearchPage() {
  const { setTitle } = usePageTitle();
  const selection = useLibrarySelection();

  // ── Shared view state ──
  const [viewParams, setViewParams] = useSearchParams();
  const projectId = viewParams.get("project") ?? undefined;
  const view: ViewMode = viewParams.get("view") === "list" ? "list" : "grid";
  const setView = (value: ViewMode) =>
    setViewParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("view", value);
      return next;
    });

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
  const browseParams = {
    sort: BROWSE_SORT_KEYS[browseSort] ?? "year_desc",
    limit: 2000,
    projectId,
  };
  const browseQuery = useQuery({
    queryKey: ["library", "browse", browseParams],
    queryFn: ({ signal }) => scholar.getPapers(browseParams, { signal }),
    select: (res) => res.papers.map(toPaperRef),
  });
  const browseLoading = browseQuery.isLoading;
  const browsePapers = browseQuery.data ?? [];

  // ── Search state (persisted in URL so back-navigation restores results) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const urlMode = searchParams.get("mode") ?? "unified";
  const urlSearched = searchParams.get("s") === "1";

  const [query, setQuery] = useState(urlQuery);
  const [mode, setMode] = useState(urlMode);
  const [modeOpen, setModeOpen] = useState(false);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(
    urlSearched && urlQuery ? { query: urlQuery, mode: urlMode } : null,
  );
  const [searched, setSearched] = useState(urlSearched && !!urlQuery);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(urlQuery);
    setMode(urlMode);
    setSearched(!!urlQuery);
    setSubmittedSearch(urlQuery ? { query: urlQuery, mode: urlMode } : null);
  }, [urlQuery, urlMode]);

  // ── Paper drawer ──
  const [selectedPaper, setSelectedPaper] = useState<PaperReference | null>(null);

  // ── Multi-select state ──
  // The selection itself lives above the library views, so papers picked here
  // stay picked while the user moves to another view to act on them. Only the
  // toolbar's on/off toggle is local; a selection made elsewhere turns it on.
  // A new query does not clear it: only a change of project does, in the
  // provider, because that changes which papers the ids can refer to.
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
    ? { query: submittedSearch.query, mode: submittedSearch.mode, limit: SEARCH_LIMIT, projectId }
    : null;
  const searchQuery = useQuery({
    queryKey: searchBody ? ["library", "search", searchBody] : ["scholar", "search", "idle"],
    queryFn: ({ signal }) => {
      if (!searchBody) throw new Error("Missing search body");
      return scholar.search(searchBody, { signal });
    },
    enabled: !!searchBody,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const rawResults: ScholarPaper[] = searchQuery.data?.results ?? [];
  const loading = searched && searchQuery.isFetching;
  const error =
    searchQuery.error instanceof Error
      ? searchQuery.error.message
      : searchQuery.error
        ? "检索失败，请确认 scholaraio serve 已启动"
        : null;

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSearched(true);
    setSelectedPaper(null);
    setSubmittedSearch({ query: q, mode });
    setSearchParams(
      { ...(projectId ? { project: projectId } : {}), view, q, mode, s: "1" },
      { replace: true },
    );
  };

  // ── Close dropdowns on outside click ──
  useEffect(() => {
    if (!modeOpen && !sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeOpen(false);
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [modeOpen, sortOpen]);

  // ── Sorted search results ──
  const sortedResults = useMemo(() => {
    return [...rawResults].sort((a, b) => {
      if (searchSort === 1) return (b.year || 0) - (a.year || 0);
      if (searchSort === 2) return Number(b.citations || 0) - Number(a.citations || 0);
      return 0;
    });
  }, [rawResults, searchSort]);

  const searchPapers = useMemo(() => sortedResults.map(toRef), [sortedResults]);

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
  const handlePaperClick = (paper: PaperReference) => {
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
          {!searched && (
            <div className="text-center mb-6">
              <h2 className="font-serif text-3xl font-bold text-on-surface mb-1.5">检索文献</h2>
              <p className="text-on-surface-variant font-sans text-sm">
                从已入库的论文中找到你需要的那篇
              </p>
            </div>
          )}

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
                    setSearched(false);
                    setSelectedPaper(null);
                    setSearchParams(
                      { ...(projectId ? { project: projectId } : {}), view },
                      { replace: true },
                    );
                  }}
                  aria-label="清空检索"
                  className="mr-3 p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

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
              <button
                type="button"
                aria-label="列表视图"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
                className={`p-1.5 rounded-lg transition-colors ${
                  view === "list"
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="卡片视图"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
                className={`p-1.5 rounded-lg transition-colors ${
                  view === "grid"
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
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
                暂无论文，请先在 scholaraio 中入库文献
              </p>
            </div>
          ) : view === "list" ? (
            <div className="flex-1 min-h-0">
              <PaperVirtualList
                papers={browsePapers}
                selectedId={selectedPaper?.id}
                onSelect={handlePaperClick}
                selectionMode={selectionMode}
                checkedIds={selection.selected}
                addedMap={selection.added}
                failedMap={selection.failed}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-8">
                {browsePapers.map((paper) => (
                  <PaperGridCard
                    key={paper.id}
                    paper={paper}
                    isSelected={!selectionMode && selectedPaper?.id === paper.id}
                    onClick={() => handlePaperClick(paper)}
                    selectionMode={selectionMode}
                    isChecked={selection.selected.has(paper.id)}
                    addedLabel={selection.added.get(paper.id) ?? null}
                    failedReason={selection.failed.get(paper.id) ?? null}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-4">
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
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-on-surface mb-1">无结果</p>
              <p className="text-xs text-on-surface-variant">尝试更换检索词或切换检索模式</p>
            </div>
          ) : view === "list" ? (
            <div className="flex-1 min-h-0">
              <PaperVirtualList
                key={submittedSearch?.query}
                papers={searchPapers}
                selectedId={selectedPaper?.id}
                onSelect={handlePaperClick}
                selectionMode={selectionMode}
                checkedIds={selection.selected}
                addedMap={selection.added}
                failedMap={selection.failed}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-8">
                {searchPapers.map((paper) => (
                  <PaperGridCard
                    key={paper.id}
                    paper={paper}
                    isSelected={!selectionMode && selectedPaper?.id === paper.id}
                    onClick={() => handlePaperClick(paper)}
                    selectionMode={selectionMode}
                    isChecked={selection.selected.has(paper.id)}
                    addedLabel={selection.added.get(paper.id) ?? null}
                    failedReason={selection.failed.get(paper.id) ?? null}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaper(null)} />
    </div>
  );
}
