import { useQuery } from "@tanstack/react-query";
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
import { queryKeys } from "../../core/queryKeys";
import { PaperDetailPanel } from "./components/PaperDetailPanel";
import { PaperGridCard } from "./components/PaperGridCard";
import { PaperVirtualList } from "./components/PaperVirtualList";
import { StatCard } from "./components/StatCard";
import { toPaperRef } from "./paperUtils";
import type { PaperReference, StatCardReference, ViewMode } from "./types";

const SORT_OPTIONS = ["年份（最新）", "引用量（高→低）", "标题"];
const SORT_KEYS = ["year_desc", "citations_desc", "title_asc"];

export function LibraryPage() {
  const { setTitle } = usePageTitle();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);

  const [selectedPaper, setSelectedPaper] = useState<PaperReference | null>(null);

  const sortRef = useRef<HTMLDivElement>(null);
  const paperParams = { sort: SORT_KEYS[sortIndex], limit: 1000 };
  const papersQuery = useQuery({
    queryKey: queryKeys.scholar.papers(paperParams),
    queryFn: ({ signal }) => scholar.getPapers(paperParams, { signal }),
    select: (res) => res.papers.map(toPaperRef),
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.scholar.stats(),
    queryFn: ({ signal }) => scholar.getStats({ signal }),
  });

  const papers = papersQuery.data ?? [];
  const stats = statsQuery.data ?? { total: 0, missingPdf: 0, pendingIngest: 0, notIndexed: 0 };
  const loading = papersQuery.isLoading || statsQuery.isLoading;
  const queryError = papersQuery.error ?? statsQuery.error;
  const error =
    queryError instanceof Error
      ? queryError.message
      : queryError
        ? "加载失败，请确认 scholaraio serve 已启动"
        : null;

  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Static header area */}
      <div className="shrink-0 overflow-y-auto no-scrollbar">
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          {statCards.map((stat) => (
            <StatCard key={stat.label} stat={stat} />
          ))}
        </section>

        {error ? (
          <div className="rounded-xl bg-error-container/10 border border-error/20 p-6 text-center text-sm text-error mb-6">
            {error}
          </div>
        ) : null}

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 relative" ref={sortRef}>
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
      </div>

      {/* Scrollable content */}
      {loading ? (
        <div className="text-center text-on-surface-variant text-sm py-20">加载中…</div>
      ) : viewMode === "list" ? (
        papers.length === 0 && !error ? (
          <div className="text-center text-on-surface-variant text-sm py-20">
            暂无论文。请在 scholaraio 目录下运行{" "}
            <code className="font-mono">scholaraio pipeline ingest</code> 入库。
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <PaperVirtualList
              papers={papers}
              selectedId={selectedPaper?.id}
              onSelect={handleSelectPaper}
            />
          </div>
        )
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-8">
            {papers.map((paper) => (
              <PaperGridCard
                key={paper.id}
                paper={paper}
                isSelected={selectedPaper?.id === paper.id}
                onClick={() => handleSelectPaper(paper)}
              />
            ))}
          </div>
          {papers.length === 0 && !error ? (
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
