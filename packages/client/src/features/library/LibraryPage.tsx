import {
  BookOpen,
  ChevronDown,
  Database,
  FolderKanban,
  LayoutGrid,
  LayoutList,
  Library,
  SortAsc,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { scholar } from "../../core/api";
import { PaperDetailPanel } from "./components/PaperDetailPanel";
import { PaperGridCard } from "./components/PaperGridCard";
import { PaperListRow } from "./components/PaperListRow";
import { StatCard } from "./components/StatCard";
import { groupByYear, toPaperRef } from "./paperUtils";
import type { PaperReference, StatCardReference, ViewMode } from "./types";

const SORT_OPTIONS = ["年份（最新）", "引用量（高→低）", "标题"];
const SORT_KEYS = ["year_desc", "citations_desc", "title_asc"];

export function LibraryPage() {
  const { setTitle } = usePageTitle();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);

  const [papers, setPapers] = useState<PaperReference[]>([]);
  const [stats, setStats] = useState({ total: 0, missingPdf: 0, pendingIngest: 0, notIndexed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<PaperReference | null>(null);

  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      scholar.getPapers({ sort: SORT_KEYS[sortIndex], limit: 1000 }),
      scholar.getStats(),
    ])
      .then(([papersRes, statsRes]) => {
        if (cancelled) return;
        setPapers(papersRes.papers.map(toPaperRef));
        setStats(statsRes);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败，请确认 scholaraio serve 已启动");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sortIndex]);

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

  const yearGroups = groupByYear(papers);

  const statCards: StatCardReference[] = [
    {
      label: "总论文数",
      value: loading ? "—" : String(stats.total),
      badge: "LIVE",
      icon: Library,
      tone: "primary",
    },
    {
      label: "缺失 PDF",
      value: loading ? "—" : String(stats.missingPdf),
      badge: "ALERT",
      icon: BookOpen,
      tone: "error",
    },
    {
      label: "待入库",
      value: loading ? "—" : String(stats.pendingIngest),
      badge: "SYNC",
      icon: FolderKanban,
      tone: "tertiary",
    },
    {
      label: "未索引",
      value: loading ? "—" : String(stats.notIndexed),
      badge: "WARN",
      icon: Database,
      tone: "secondary",
    },
  ];

  const handleSelectPaper = (paper: PaperReference) => {
    setSelectedPaper((prev) => (prev?.id === paper.id ? null : paper));
  };

  return (
    <div
      className="flex-1 overflow-y-auto no-scrollbar transition-all duration-[220ms] ease-in-out"
      style={{ paddingRight: selectedPaper ? "396px" : undefined }}
    >
      <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        {statCards.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </section>

      {error ? (
        <div className="rounded-xl bg-error-container/10 border border-error/20 p-6 text-center text-sm text-error">
          {error}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 relative" ref={sortRef}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high rounded-full text-sm font-medium text-primary hover:bg-surface-container active:scale-95 transition-all"
            >
              <SortAsc className="w-3.5 h-3.5" />
              {SORT_OPTIONS[sortIndex]}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${sortOpen ? "rotate-180" : ""}`}
              />
            </button>

            {sortOpen ? (
              <div className="absolute top-9 left-0 z-20 w-48 bg-surface-container-high border border-outline-variant/20 rounded-xl p-1.5 shadow-xl">
                {SORT_OPTIONS.map((opt, i) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setSortIndex(i);
                      setSortOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
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

          <div className="h-4 w-px bg-outline-variant/30" />
          <p className="text-sm text-on-surface-variant font-sans">
            共 <span className="font-bold text-on-surface">{papers.length}</span> 篇
          </p>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === "list"
                ? "bg-primary/10 text-primary"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <LayoutList className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === "grid"
                ? "bg-primary/10 text-primary"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-on-surface-variant text-sm py-20">加载中…</div>
      ) : (
        <div className="space-y-8">
          {yearGroups.map((group) => (
            <section key={group.year}>
              <div className="flex items-center gap-4 mb-4">
                <h2 className="font-serif text-xl font-bold text-on-surface">
                  {group.year || "未知年份"}
                </h2>
                <span className="text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                  {group.papers.length} papers
                </span>
                <div className="flex-1 h-px bg-outline-variant/10" />
              </div>

              {viewMode === "list" ? (
                <div className="space-y-3">
                  {group.papers.map((paper) => (
                    <PaperListRow
                      key={paper.id}
                      paper={paper}
                      isSelected={selectedPaper?.id === paper.id}
                      onClick={() => handleSelectPaper(paper)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {group.papers.map((paper) => (
                    <PaperGridCard
                      key={paper.id}
                      paper={paper}
                      isSelected={selectedPaper?.id === paper.id}
                      onClick={() => handleSelectPaper(paper)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          {yearGroups.length === 0 && !error ? (
            <div className="text-center text-on-surface-variant text-sm py-20">
              暂无论文。请在 scholaraio 目录下运行{" "}
              <code className="font-mono">scholaraio pipeline ingest</code> 入库。
            </div>
          ) : null}
        </div>
      )}

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaper(null)} />
    </div>
  );
}
