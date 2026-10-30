import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { libraryApi } from "../../core/library";
import { usePageTitle } from "../../shared/layout";
import { LibraryAnalyticsPanel } from "./components/LibraryAnalyticsPanel";
import { LibraryTasksPanel } from "./components/LibraryTasksPanel";
import { toPaperSummary } from "./paperSummary";
import { buildTopicColors } from "./utils/topicColors";

/**
 * Where the library is looked at as a whole: one map of it, and its topics.
 *
 * Everything the map needs — topics for the colours, the two-dimensional
 * placement — comes from one analytics call. Where the work that produces
 * them stands heads the column beside it.
 */
export default function LibraryDashboard() {
  const { setTitle } = usePageTitle();

  const analytics = useQuery({
    queryKey: ["library", "analytics"],
    queryFn: ({ signal }) => libraryApi.analytics(signal),
  });
  const papersQuery = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
  });
  const projection = analytics.data?.projection;
  const topics = analytics.data?.topics?.topics ?? [];
  const raw = papersQuery.data?.papers;
  const papers = useMemo(() => (raw ?? []).map(toPaperSummary), [raw]);
  const error = papersQuery.error?.message ?? analytics.error?.message;
  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

  const topicColors = useMemo(() => buildTopicColors(topics.map((topic) => topic.id)), [topics]);
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto p-4">
      {error ? (
        <div className="shrink-0 rounded-lg bg-error-container/10 border border-error/20 p-4 text-center text-sm text-error">
          {error}
        </div>
      ) : null}

      <LibraryAnalyticsPanel
        papers={papers}
        projection={projection}
        topics={topics}
        topicColors={topicColors}
        loading={papersQuery.isLoading || analytics.isLoading}
        status={<LibraryTasksPanel />}
        placeholder={
          !papersQuery.isLoading && papers.length === 0 && !error ? (
            <p className="text-center text-on-surface-variant text-sm">
              还没有论文。
              <Link className="text-primary" to="/library?import=1">
                先导入文献
              </Link>
              ，这里会画出它们的主题分布。
            </p>
          ) : !analytics.isLoading && topics.length === 0 ? (
            // Without topics the map has no colours and no coordinates. Building
            // them is long work, so the page points at it rather than starting it.
            <div className="max-w-sm text-center">
              <p className="font-serif text-base font-semibold text-on-surface">尚未建立主题</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                在右侧「文献库能力」中点「管理」构建主题地图，这里会画出文献的主题分布。
              </p>
            </div>
          ) : null
        }
      />
    </div>
  );
}
