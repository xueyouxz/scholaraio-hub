import { useQuery } from "@tanstack/react-query";
import { Library } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { libraryApi } from "../../core/library";
import { CapabilityPrompt } from "./components/CapabilityPrompt";
import { CitationCheckPanel } from "./components/CitationCheckPanel";
import { LibraryAnalyticsPanel } from "./components/LibraryAnalyticsPanel";
import { LibraryTasksPanel } from "./components/LibraryTasksPanel";
import { TopicSimilarityHeatmap } from "./components/charts/TopicSimilarityHeatmap";
import { TopicTimeTrend } from "./components/charts/TopicTimeTrend";
import { buildYearCounts, toLibraryPaperRef } from "./paperUtils";
import { buildTopicColors } from "./utils/topicColors";

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

export default function LibraryDashboard() {
  const { setTitle } = usePageTitle();
  const [activeTopicIds, setActiveTopicIds] = useState<number[]>([]);
  const yearRange: [number, number] | null = null;

  const analytics = useQuery({
    queryKey: ["library", "analytics"],
    queryFn: ({ signal }) => libraryApi.analytics(undefined, signal),
  });
  const papersQuery = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    select: (data) => data.papers.map(toLibraryPaperRef),
  });
  const projectionQuery = { data: analytics.data?.projection };
  const topicsQuery = { data: analytics.data?.topics };
  const topicSimilarityQuery = { data: analytics.data?.similarity };
  const projectionBuilt = projectionQuery.data?.built ?? false;
  const projectionPoints = projectionQuery.data?.points ?? [];
  const papers = papersQuery.data ?? [];
  const stats = {
    total: papers.length,
    pendingIngest: papers.filter((p) => !p.hasPdf).length,
    missingPdf: papers.filter((p) => !p.hasPdfFile).length,
    notIndexed: papers.filter((p) => !p.isIndexed).length,
  };
  const loading = papersQuery.isLoading || analytics.isLoading;
  const error = papersQuery.error?.message ?? analytics.error?.message;
  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

  const yearCounts = useMemo(() => buildYearCounts(papers), [papers]);
  const topics = topicsQuery.data?.topics ?? [];
  const topicColors = useMemo(() => buildTopicColors(topics.map((topic) => topic.id)), [topics]);

  const statusCounts = {
    pendingIngest: stats.pendingIngest,
    missingPdf: stats.missingPdf,
    notIndexed: stats.notIndexed,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto gap-2 p-2">
      {error ? (
        <div className="shrink-0 rounded-lg bg-error-container/10 border border-error/20 p-4 text-center text-sm text-error">
          {error}
        </div>
      ) : null}

      <LibraryTasksPanel />
      <section className="shrink-0 rounded-lg border border-outline-variant/10 bg-surface-container-low p-3">
        <CitationCheckPanel />
      </section>

      {loading ? (
        <div className="text-center text-on-surface-variant text-sm py-20">加载中…</div>
      ) : papers.length === 0 && !error ? (
        <div className="text-center text-on-surface-variant text-sm py-20">
          还没有论文。
          <Link className="text-primary" to="/library?import=1">
            先导入文献
          </Link>
          ，这里会画出它们的主题分布。
        </div>
      ) : topics.length === 0 ? (
        // Without topics every chart here is empty, so the page asks for the
        // one thing that would fill it instead of drawing nothing.
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="w-full max-w-sm">
            <CapabilityPrompt kind="topics" explain framed />
          </div>
        </div>
      ) : (
        <div className="flex flex-col lg:grid flex-1 min-h-0 gap-2 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="flex shrink-0 min-h-[540px] lg:min-h-0 flex-col gap-2">
            <article className="h-[120px] shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-lg px-4 py-3.5 flex flex-col justify-between">
              <Library className="w-5 h-5 text-primary" />
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="font-mono text-4xl font-bold text-primary leading-none">
                    {stats.total}
                  </div>
                  <div className="text-[10px] font-medium text-on-surface-variant uppercase tracking-wider mt-1">
                    论文总数
                  </div>
                </div>
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
              </div>
            </article>

            <section className="flex-[3] min-h-[240px] bg-surface-container-low border border-outline-variant/10 rounded-lg px-2 pt-2 pb-2 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
                  主题语义相似矩阵
                </div>
                {topicSimilarityQuery.data?.topicCount ? (
                  <div className="text-[10px] font-mono text-on-surface-variant">
                    TOP {topicSimilarityQuery.data.topicCount}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 min-h-0">
                <TopicSimilarityHeatmap
                  similarity={topicSimilarityQuery.data}
                  activeTopicIds={activeTopicIds}
                  onTopicSelect={(ids) => setActiveTopicIds(ids)}
                />
              </div>
            </section>

            <section
              aria-label="主题时间趋势"
              className="flex-[2] min-h-[150px] bg-surface-container-low border border-outline-variant/10 rounded-lg px-3 pt-2.5 pb-2.5 flex flex-col"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
                  主题时间趋势
                </div>
                {activeTopicIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTopicIds([])}
                    className="text-[10px] font-mono font-bold text-primary hover:text-primary-container transition-colors"
                  >
                    清除 {activeTopicIds.map((id) => `T${id}`).join(", ")}
                  </button>
                ) : null}
              </div>
              <div className="flex-1 min-h-0">
                <TopicTimeTrend
                  built={projectionBuilt}
                  topics={topics}
                  points={projectionPoints}
                  topicColors={topicColors}
                  yearCounts={yearCounts}
                  yearRange={yearRange}
                  activeTopicIds={activeTopicIds}
                />
              </div>
            </section>
          </div>

          <LibraryAnalyticsPanel
            papers={papers}
            yearRange={yearRange}
            topicsOverview={topicsQuery.data}
            projection={projectionQuery.data}
            topicColors={topicColors}
            activeTopicIds={activeTopicIds}
            onTopicSelect={(ids) => setActiveTopicIds(ids)}
          />
        </div>
      )}
    </div>
  );
}
