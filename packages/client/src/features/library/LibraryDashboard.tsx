import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../../app/components/NavigationLayout";
import { libraryApi } from "../../core/library";
import { CapabilityPrompt } from "./components/CapabilityPrompt";
import { LibraryAnalyticsPanel } from "./components/LibraryAnalyticsPanel";
import { LibraryTasksPanel } from "./components/LibraryTasksPanel";
import { toLibraryPaperRef } from "./paperUtils";
import { buildTopicColors } from "./utils/topicColors";

/**
 * Where the library is looked at as a whole: one map of it.
 *
 * The projection is the only view here. Everything it needs — topics for the
 * colours, the two-dimensional placement — comes from one analytics call, and
 * the work that produces them is offered above it.
 */
export default function LibraryDashboard() {
  const { setTitle } = usePageTitle();

  const analytics = useQuery({
    queryKey: ["library", "analytics"],
    queryFn: ({ signal }) => libraryApi.analytics(undefined, signal),
  });
  const papersQuery = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    select: (data) => data.papers.map(toLibraryPaperRef),
  });
  const projection = analytics.data?.projection;
  const topics = analytics.data?.topics?.topics ?? [];
  const papers = papersQuery.data ?? [];
  const loading = papersQuery.isLoading || analytics.isLoading;
  const error = papersQuery.error?.message ?? analytics.error?.message;
  useEffect(() => {
    setTitle("Library");
    return () => setTitle("");
  }, [setTitle]);

  const topicColors = useMemo(() => buildTopicColors(topics.map((topic) => topic.id)), [topics]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto gap-3 p-4">
      {error ? (
        <div className="shrink-0 rounded-lg bg-error-container/10 border border-error/20 p-4 text-center text-sm text-error">
          {error}
        </div>
      ) : null}

      <LibraryTasksPanel />

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
        // Without topics the map has no colours and no coordinates, so the page
        // asks for the one thing that would fill it instead of drawing nothing.
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="w-full max-w-sm">
            <CapabilityPrompt kind="topics" explain />
          </div>
        </div>
      ) : (
        <LibraryAnalyticsPanel papers={papers} projection={projection} topicColors={topicColors} />
      )}
    </div>
  );
}
