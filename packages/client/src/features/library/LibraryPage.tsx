import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Library, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { scholar } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import { LibraryAnalyticsPanel } from "./components/LibraryAnalyticsPanel";
import { YearHistogram } from "./components/charts/YearHistogram";
import { useJobMutation } from "./hooks/useJobMutation";
import { buildYearCounts, toPaperRef } from "./paperUtils";

const STATUS_BADGES = [
  {
    key: "pendingIngest" as const,
    label: "待入库",
    color: "bg-tertiary/10 text-tertiary",
  },
  {
    key: "missingPdf" as const,
    label: "缺 PDF",
    color: "bg-secondary/10 text-secondary",
  },
  {
    key: "notIndexed" as const,
    label: "未索引",
    color: "bg-error/10 text-error",
  },
] as const;

export function LibraryPage() {
  const { setTitle } = usePageTitle();
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);

  const projectionQuery = useQuery({
    queryKey: queryKeys.scholar.projection(),
    queryFn: ({ signal }) => scholar.getProjection({ signal }),
    staleTime: 30_000,
  });
  const projectJob = useJobMutation("project");
  const projectionBuilt = projectionQuery.data?.built ?? false;
  const projectionStale = projectionQuery.data?.stale ?? false;

  const papersQuery = useQuery({
    queryKey: queryKeys.scholar.papers({ sort: "year_desc", limit: 5000 }),
    queryFn: ({ signal }) => scholar.getPapers({ sort: "year_desc", limit: 5000 }, { signal }),
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

  const yearCounts = useMemo(() => buildYearCounts(papers), [papers]);

  const statusCounts = {
    pendingIngest: stats.pendingIngest,
    missingPdf: stats.missingPdf,
    notIndexed: stats.notIndexed,
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden gap-4">
      <div className="shrink-0 flex gap-4" style={{ height: 120 }}>
        <article className="w-56 shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-xl px-5 py-4 flex flex-col justify-between">
          <Library className="w-5 h-5 text-primary" />
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-4xl font-bold text-primary leading-none">
                {loading ? "—" : stats.total}
              </div>
              <div className="text-[10px] font-medium text-on-surface-variant uppercase tracking-wider mt-1">
                论文总数
              </div>
            </div>
            {!loading && (
              <div className="flex flex-col gap-1 items-end mb-0.5">
                {STATUS_BADGES.filter(({ key }) => statusCounts[key] > 0).map(
                  ({ key, label, color }) => (
                    <span
                      key={key}
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${color}`}
                    >
                      {label} {statusCounts[key]}
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        </article>

        <div className="flex-1 bg-surface-container-low border border-outline-variant/10 rounded-xl px-4 pt-3 pb-2 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              年份分布
            </div>
            {projectionBuilt && projectionStale && (
              <div className="flex items-center gap-1.5 shrink-0">
                <AlertTriangle className="w-3 h-3 text-tertiary shrink-0" />
                <span className="text-[10px] font-mono text-tertiary">投影数据不完整</span>
                <button
                  type="button"
                  onClick={projectJob.submit}
                  disabled={projectJob.isPending}
                  className="flex items-center gap-1 px-2 py-0.5 bg-tertiary/10 hover:bg-tertiary/20 text-tertiary text-[10px] font-mono font-bold rounded-md transition-colors disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-2.5 h-2.5 ${projectJob.isPending ? "animate-spin" : ""}`}
                  />
                  {projectJob.isPending ? "计算中" : "重算"}
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <YearHistogram yearCounts={yearCounts} yearRange={yearRange} onBrush={setYearRange} />
          </div>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 rounded-xl bg-error-container/10 border border-error/20 p-6 text-center text-sm text-error">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-center text-on-surface-variant text-sm py-20">加载中…</div>
      ) : papers.length === 0 && !error ? (
        <div className="text-center text-on-surface-variant text-sm py-20">
          暂无论文。请在 scholaraio 目录下运行{" "}
          <code className="font-mono">scholaraio pipeline ingest</code> 入库。
        </div>
      ) : (
        <LibraryAnalyticsPanel papers={papers} yearRange={yearRange} />
      )}
    </div>
  );
}
