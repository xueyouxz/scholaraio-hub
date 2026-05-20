import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { type ScholarPaper, scholar } from "../../core/api";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { PaperDetailPanel } from "../library/components/PaperDetailPanel";
import type { PaperReference } from "../library/types";
import { DocTypeFilter, type DocTypeKey, normalizePaperType } from "./components/DocTypeFilter";
import { SearchResultCard } from "./components/SearchResultCard";
import { SearchSkeleton } from "./components/SearchSkeleton";
import { type YearBin, YearRangeFilter } from "./components/YearRangeFilter";

// ─── Constants ────────────────────────────────────────────────────────────────

const SORT_OPTIONS = ["相关度", "年份（最新）", "引用量（高→低）"];
const DOC_TYPE_LABELS: DocTypeKey[] = ["期刊论文", "会议论文", "预印本"];
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

// Module-level LRU cache (key = "mode:query")
const MAX_CACHE = 10;
const queryCache = new Map<string, ScholarPaper[]>();
function cacheSet(key: string, value: ScholarPaper[]) {
  if (queryCache.size >= MAX_CACHE) {
    queryCache.delete(queryCache.keys().next().value as string);
  }
  queryCache.set(key, value);
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
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SearchPage() {
  const { setTitle } = usePageTitle();

  // ── Search state ──
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("unified");
  const [modeOpen, setModeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);

  const [rawResults, setRawResults] = useState<ScholarPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // ── Filter state ──
  const [selectedDocTypes, setSelectedDocTypes] = useState<Set<DocTypeKey>>(new Set());
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [dimmed, setDimmed] = useState(false);

  // ── Paper drawer ──
  const [selectedPaper, setSelectedPaper] = useState<PaperReference | null>(null);

  // ── Refs ──
  const modeRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setTitle("Search");
    return () => setTitle("");
  }, [setTitle]);

  // ── Search ──
  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSearched(true);
    setSelectedDocTypes(new Set());
    setYearRange(null);
    setError(null);
    setSelectedPaper(null);

    const cacheKey = `${mode}:${q}`;
    const cached = queryCache.get(cacheKey);
    if (cached) {
      setRawResults(cached);
      return;
    }

    setLoading(true);
    scholar
      .search({ query: q, mode, limit: SEARCH_LIMIT })
      .then((res) => {
        cacheSet(cacheKey, res.results);
        setRawResults(res.results);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "检索失败，请确认 scholaraio serve 已启动"),
      )
      .finally(() => setLoading(false));
  };

  // ── Init year range from results ──
  useEffect(() => {
    if (!rawResults.length) {
      setYearRange(null);
      return;
    }
    const years = rawResults.map((p) => p.year).filter((y) => y > 1900);
    if (years.length) setYearRange([Math.min(...years), Math.max(...years)]);
  }, [rawResults]);

  // ── Fade on filter change ──
  const triggerFade = () => {
    if (dimTimer.current) clearTimeout(dimTimer.current);
    setDimmed(true);
    dimTimer.current = setTimeout(() => setDimmed(false), 180);
  };

  const handleDocTypeToggle = (key: DocTypeKey) => {
    triggerFade();
    setSelectedDocTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleYearChange = (range: [number, number]) => {
    triggerFade();
    setYearRange(range);
  };

  // ── Close dropdowns on outside click ──
  useEffect(() => {
    if (!modeOpen && !sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modeOpen, sortOpen]);

  // ── Derived data ──
  const yearBounds = useMemo((): [number, number] | null => {
    const years = rawResults.map((p) => p.year).filter((y) => y > 1900);
    return years.length ? [Math.min(...years), Math.max(...years)] : null;
  }, [rawResults]);

  const yearBins = useMemo((): YearBin[] => {
    if (!yearBounds) return [];
    const [minY, maxY] = yearBounds;
    const counts: Record<number, number> = {};
    for (let y = minY; y <= maxY; y++) counts[y] = 0;
    for (const p of rawResults) {
      if (p.year && p.year >= minY && p.year <= maxY) {
        counts[p.year] = (counts[p.year] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([y, c]) => ({ year: Number(y), count: c }))
      .sort((a, b) => a.year - b.year);
  }, [rawResults, yearBounds]);

  const docTypeDist = useMemo(() => {
    const counts: Record<DocTypeKey, number> = { 期刊论文: 0, 会议论文: 0, 预印本: 0 };
    for (const p of rawResults) {
      const t = normalizePaperType(p.paperType);
      if (t) counts[t]++;
    }
    return counts;
  }, [rawResults]);

  const docTypeOptions = DOC_TYPE_LABELS.filter((k) => docTypeDist[k] > 0).map((k) => ({
    key: k,
    label: k,
    count: docTypeDist[k],
  }));

  const filteredResults = useMemo(() => {
    return rawResults.filter((p) => {
      if (selectedDocTypes.size > 0) {
        const t = normalizePaperType(p.paperType);
        if (!t || !selectedDocTypes.has(t)) return false;
      }
      if (yearRange && (p.year < yearRange[0] || p.year > yearRange[1])) return false;
      return true;
    });
  }, [rawResults, selectedDocTypes, yearRange]);

  const sortedResults = useMemo(() => {
    return [...filteredResults].sort((a, b) => {
      if (sortIndex === 1) return (b.year || 0) - (a.year || 0);
      if (sortIndex === 2) return Number(b.citations || 0) - Number(a.citations || 0);
      return 0;
    });
  }, [filteredResults, sortIndex]);

  // Scroll to top when results change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [sortedResults]);

  const hintCount = useMemo(() => {
    if (filteredResults.length > 0 || !searched || loading || !rawResults.length) return null;
    if (yearRange && yearBounds && (yearRange[0] > yearBounds[0] || yearRange[1] < yearBounds[1])) {
      const n = rawResults.filter(
        (p) =>
          selectedDocTypes.size === 0 ||
          (() => {
            const t = normalizePaperType(p.paperType);
            return !!(t && selectedDocTypes.has(t));
          })(),
      ).length;
      if (n > 0) return { label: "移除年份限制", count: n };
    }
    if (selectedDocTypes.size > 0) {
      const n = rawResults.filter(
        (p) => !yearRange || (p.year >= yearRange[0] && p.year <= yearRange[1]),
      ).length;
      if (n > 0) return { label: "移除文档类型过滤", count: n };
    }
    return null;
  }, [filteredResults, rawResults, yearRange, yearBounds, selectedDocTypes, searched, loading]);

  const showFilters = searched && !loading && rawResults.length > 0;
  const currentMode = SEARCH_MODES.find((m) => m.id === mode) ?? SEARCH_MODES[0]!;

  // ── Virtualizer ──
  const virtualizer = useVirtualizer({
    count: sortedResults.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 4,
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Search header ── */}
      <header className="shrink-0 pt-8 pb-5 px-6">
        <div className="max-w-3xl mx-auto">
          {!searched && (
            <div className="text-center mb-7">
              <h2 className="font-serif text-4xl font-bold text-on-surface mb-2">
                检索集体知识网络
              </h2>
              <p className="text-on-surface-variant font-sans text-sm">
                面向学术研究的语义检索、主题聚类与结构化综合界面。
              </p>
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <div className="w-full bg-surface-container-lowest rounded-2xl flex items-center border border-outline-variant/20 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-all shadow-sm">
              {/* Mode selector — fused into left of input */}
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

              {/* Divider */}
              <div className="h-4 w-px bg-outline-variant/30 shrink-0" />

              {/* Text input */}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="输入并搜索"
                className="flex-1 bg-transparent text-on-surface px-3 py-3 font-sans text-sm outline-none placeholder:text-on-surface-variant/40"
              />

              {/* Clear button */}
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setRawResults([]);
                    setSearched(false);
                    setYearRange(null);
                    setSelectedDocTypes(new Set());
                    setSelectedPaper(null);
                  }}
                  className="mr-3 p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {/* Loading progress bar */}
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

      {/* ── Body ── */}
      {!searched ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
              <Search className="w-5 h-5 text-on-surface-variant/40" />
            </div>
            <p className="text-sm text-on-surface-variant">选择搜索模式，输入检索词后按 Enter</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex-1 overflow-hidden px-6 pt-2">
          <div className="max-w-3xl mx-auto">
            <SearchSkeleton />
          </div>
        </div>
      ) : (
        /* ── Two-column layout (results exist) ── */
        <div
          className="flex gap-5 px-6 pb-4 flex-1 min-h-0 items-start max-w-[1440px] mx-auto w-full transition-[padding] duration-[220ms]"
          style={{ paddingRight: selectedPaper ? "404px" : "24px" }}
        >
          {/* Filter panel */}
          {showFilters && (
            <aside className="w-60 shrink-0 overflow-y-auto no-scrollbar">
              <div className="bg-surface-container-low rounded-xl p-5 flex flex-col gap-6">
                {docTypeOptions.length > 0 && (
                  <div>
                    <SectionLabel label="文档类型" accent="primary" />
                    <div className="mt-3">
                      <DocTypeFilter
                        options={docTypeOptions}
                        selected={selectedDocTypes}
                        onToggle={handleDocTypeToggle}
                      />
                    </div>
                  </div>
                )}
                {yearBounds && yearRange && (
                  <div>
                    <SectionLabel label="发表年份" accent="primary" />
                    <div className="mt-3">
                      <YearRangeFilter
                        bins={yearBins}
                        minYear={yearBounds[0]}
                        maxYear={yearBounds[1]}
                        value={yearRange}
                        onChange={handleYearChange}
                      />
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Results section */}
          <section className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-0">
            {/* Error */}
            {error && (
              <div className="shrink-0 rounded-xl bg-error-container/10 border border-error/20 p-4 text-sm text-error mb-4">
                {error}
              </div>
            )}

            {/* Results bar */}
            {searched && (
              <div
                className="shrink-0 flex items-center justify-between h-9 mb-3 px-1"
                ref={sortRef}
              >
                <div className="text-sm text-on-surface-variant font-mono">
                  <span className="font-bold text-primary">{filteredResults.length}</span>
                  {rawResults.length !== filteredResults.length && (
                    <span className="text-on-surface-variant/50"> / {rawResults.length}</span>
                  )}{" "}
                  结果
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors font-mono"
                  >
                    排序：
                    <span className="font-bold text-on-surface">{SORT_OPTIONS[sortIndex]}</span>
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${sortOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {sortOpen && (
                    <div className="absolute right-0 top-6 z-20 bg-surface-container-high border border-outline-variant/20 rounded-xl p-1.5 w-40 shadow-xl">
                      {SORT_OPTIONS.map((opt, i) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setSortIndex(i);
                            setSortOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            i === sortIndex
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
              </div>
            )}

            {/* Virtual results list */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto no-scrollbar transition-opacity duration-200"
              style={{ opacity: dimmed ? 0 : 1 }}
            >
              {sortedResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="text-sm font-medium text-on-surface mb-2">当前过滤条件下无结果</p>
                  {hintCount ? (
                    <p className="text-xs text-on-surface-variant">
                      {hintCount.label}后可找到{" "}
                      <span className="font-bold text-primary">{hintCount.count}</span> 篇
                    </p>
                  ) : (
                    <p className="text-xs text-on-surface-variant">尝试调整过滤条件或更换检索词</p>
                  )}
                </div>
              ) : (
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                  {virtualizer.getVirtualItems().map((vItem) => {
                    const paper = sortedResults[vItem.index];
                    if (!paper) return null;
                    return (
                      <div
                        key={vItem.key}
                        data-index={vItem.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vItem.start}px)`,
                          paddingBottom: "16px",
                        }}
                      >
                        <SearchResultCard
                          paper={toRef(paper)}
                          isSelected={selectedPaper?.id === paper.id}
                          onClick={() =>
                            setSelectedPaper((prev) =>
                              prev?.id === paper.id ? null : toRef(paper),
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Paper detail drawer (reuses library component) */}
      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaper(null)} />
    </div>
  );
}
