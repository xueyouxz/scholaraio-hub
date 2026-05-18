import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { type ScholarPaper, scholar } from "../../core/api";
import { FilterCheckboxRow } from "../../shared/ui/FilterCheckboxRow";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import type { PaperReference } from "../library/types";
import { SearchResultCard } from "./components/SearchResultCard";

const SORT_OPTIONS = ["相关度", "年份（最新）", "引用量（高→低）"];

interface FilterGroup {
  title: string;
  options: { label: string; checked: boolean }[];
}

const DEFAULT_FILTERS: FilterGroup[] = [
  {
    title: "文档类型",
    options: [
      { label: "期刊论文", checked: false },
      { label: "综述", checked: false },
      { label: "会议论文", checked: false },
    ],
  },
  {
    title: "状态",
    options: [
      { label: "已入库", checked: false },
      { label: "仅有 PDF", checked: false },
    ],
  },
];

function toSearchResult(p: ScholarPaper): PaperReference {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    source: p.source,
    year: p.year,
    citations: p.citations,
    status: p.status,
    hasPdf: p.hasPdf,
    isIndexed: p.isIndexed,
    abstract: p.abstract,
  };
}

export function SearchPage() {
  const { setTitle } = usePageTitle();
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);
  const [filters, setFilters] = useState<FilterGroup[]>(DEFAULT_FILTERS);

  const [results, setResults] = useState<ReturnType<typeof toSearchResult>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle("Search");
    return () => setTitle("");
  }, [setTitle]);

  const handleSearch = () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    scholar
      .search({ query: query.trim(), mode: "unified", limit: 50 })
      .then((res) => setResults(res.results.map(toSearchResult)))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "检索失败，请确认 scholaraio serve 已启动"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  const sortedResults = [...results].sort((a, b) => {
    if (sortIndex === 1) return (b.year || 0) - (a.year || 0);
    if (sortIndex === 2) return Number(b.citations || 0) - Number(a.citations || 0);
    return 0;
  });

  const toggleFilter = (groupIndex: number, optionIndex: number) => {
    setFilters((prev) =>
      prev.map((group, gi) =>
        gi !== groupIndex
          ? group
          : {
              ...group,
              options: group.options.map((opt, oi) =>
                oi !== optionIndex ? opt : { ...opt, checked: !opt.checked },
              ),
            },
      ),
    );
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pt-2 pb-12">
      <header className="max-w-4xl mx-auto mb-10">
        <div className="flex flex-col items-center text-center mb-6">
          <h2 className="font-serif text-4xl font-bold text-on-surface mb-2">检索集体知识网络</h2>
          <p className="text-on-surface-variant max-w-xl font-sans text-sm">
            面向学术研究的语义检索、主题聚类与结构化综合界面。
          </p>
        </div>

        <div className="relative max-w-3xl mx-auto">
          <div className="w-full bg-surface-container-low rounded-xl flex items-center px-4 border border-outline-variant/20 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-all">
            <Search className="w-4 h-4 text-on-surface-variant shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="输入检索词，按 Enter 搜索…"
              className="flex-1 bg-transparent text-on-surface px-3 py-3 font-sans text-sm outline-none placeholder:text-on-surface-variant/50"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setSearched(false);
                }}
                className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8 items-start px-2">
        <aside className="w-full lg:w-[280px] bg-surface-container-low rounded-xl p-6 flex flex-col gap-8 shrink-0">
          {filters.map((group, gi) => (
            <div key={group.title}>
              <SectionLabel label={group.title} accent="primary" />
              <div className="flex flex-col gap-3 mt-4">
                {group.options.map((opt, oi) => (
                  <FilterCheckboxRow
                    key={opt.label}
                    label={opt.label}
                    checked={opt.checked}
                    onChange={() => toggleFilter(gi, oi)}
                  />
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section className="flex-grow">
          {error ? (
            <div className="rounded-xl bg-error-container/10 border border-error/20 p-6 text-sm text-error mb-6">
              {error}
            </div>
          ) : null}

          {searched && !loading ? (
            <div
              className="flex items-center justify-between h-12 mb-6 px-2 relative"
              ref={sortRef}
            >
              <div className="text-sm text-on-surface-variant font-mono">
                <span className="font-bold text-primary">{sortedResults.length}</span> 结果
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface"
                  >
                    <span>
                      排序：
                      <span className="font-bold text-on-surface">{SORT_OPTIONS[sortIndex]}</span>
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${sortOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {sortOpen ? (
                    <div className="absolute right-0 top-8 z-20 bg-surface-container-high border border-outline-variant/20 rounded-xl p-1.5 w-44 shadow-xl">
                      {SORT_OPTIONS.map((opt, i) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setSortIndex(i);
                            setSortOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            i === sortIndex
                              ? "bg-primary/10 text-primary font-semibold"
                              : "text-on-surface hover:bg-surface-container"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="text-center text-on-surface-variant text-sm py-20">检索中…</div>
          ) : !searched ? (
            <div className="text-center text-on-surface-variant text-sm py-20">
              输入检索词后按 Enter 开始搜索
            </div>
          ) : sortedResults.length === 0 ? (
            <div className="text-center text-on-surface-variant text-sm py-20">未找到相关论文</div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {sortedResults.map((paper) => (
                <SearchResultCard key={paper.id} paper={paper} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
