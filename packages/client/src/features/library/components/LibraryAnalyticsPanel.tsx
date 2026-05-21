import { useQuery } from "@tanstack/react-query";
import { Lasso, X, ZoomIn } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { scholar } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";
import { useJobMutation } from "../hooks/useJobMutation";
import type { PaperReference } from "../types";
import { buildTopicColors } from "../utils/topicColors";
import { PaperDetailPanel } from "./PaperDetailPanel";
import { TopicBubbleBar } from "./TopicBubbleBar";
import { ScatterPlot } from "./charts/ScatterPlot";
import type { ScatterMode } from "./charts/ScatterPlotController";

interface Props {
  papers: PaperReference[];
  yearRange: [number, number] | null;
}

export function LibraryAnalyticsPanel({ papers, yearRange }: Props) {
  const [activeTopicId, setActiveTopicId] = useState<number | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [scatterMode, setScatterMode] = useState<ScatterMode>("none");
  const [lassoFills, setLassoFills] = useState<Map<
    number,
    { ratio: number; count: number }
  > | null>(null);

  const topicsQuery = useQuery({
    queryKey: queryKeys.scholar.topics(),
    queryFn: ({ signal }) => scholar.getTopics({ signal }),
    staleTime: 30_000,
  });

  const projectionQuery = useQuery({
    queryKey: queryKeys.scholar.projection(),
    queryFn: ({ signal }) => scholar.getProjection({ signal }),
    staleTime: 30_000,
  });

  const topicsJob = useJobMutation("topics");
  const projectJob = useJobMutation("project");

  const topics = topicsQuery.data?.topics ?? [];
  const topicsBuilt = topicsQuery.data?.built ?? false;
  const projectionBuilt = projectionQuery.data?.built ?? false;
  const projectionPoints = projectionQuery.data?.points ?? [];

  const topicColors = useMemo(() => buildTopicColors(topics.map((t) => t.id)), [topics]);

  const activeIds = useMemo<Set<string> | null>(() => {
    const hasYear = yearRange !== null;
    const hasTopic = activeTopicId !== null;

    if (!hasYear && !hasTopic) return null;

    let ids: Set<string> | null = null;

    if (hasYear && yearRange) {
      const [y0, y1] = yearRange;
      const byYear = new Set(papers.filter((p) => p.year >= y0 && p.year <= y1).map((p) => p.id));
      ids = byYear;
    }

    if (hasTopic) {
      const byTopic = new Set(
        projectionPoints.filter((pt) => pt.topicId === activeTopicId).map((pt) => pt.id),
      );
      ids = ids ? new Set([...ids].filter((id) => byTopic.has(id))) : byTopic;
    }

    return ids ?? new Set();
  }, [yearRange, activeTopicId, papers, projectionPoints]);

  const selectedPaper = useMemo(
    () => (selectedPaperId ? (papers.find((p) => p.id === selectedPaperId) ?? null) : null),
    [selectedPaperId, papers],
  );

  const handleLassoSelect = useCallback(
    (selectedIds: Set<string>) => {
      if (selectedIds.size === 0) {
        setLassoFills(null);
        return;
      }
      const topicCounts = new Map<number, number>();
      for (const pt of projectionPoints) {
        if (selectedIds.has(pt.id)) {
          topicCounts.set(pt.topicId, (topicCounts.get(pt.topicId) ?? 0) + 1);
        }
      }
      const fills = new Map<number, { ratio: number; count: number }>();
      for (const [topicId, count] of topicCounts) {
        fills.set(topicId, { ratio: count / selectedIds.size, count });
      }
      setLassoFills(fills);
    },
    [projectionPoints],
  );

  const toggleMode = (m: ScatterMode) => setScatterMode((prev) => (prev === m ? "none" : m));

  const clearLasso = () => {
    setLassoFills(null);
    setScatterMode("none");
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <TopicBubbleBar
        built={topicsBuilt}
        topics={topics}
        topicColors={topicColors}
        activeTopicId={activeTopicId}
        lassoFills={lassoFills}
        onTopicClick={setActiveTopicId}
        onBuildRequest={topicsJob.submit}
      />

      <div className="relative flex-1 min-h-0 w-full max-w-[720px] mx-auto bg-surface-container-low border border-outline-variant/10 rounded-xl overflow-hidden">
        {projectionBuilt ? (
          <>
            <ScatterPlot
              points={projectionPoints}
              activeIds={activeIds}
              selectedId={selectedPaperId}
              topicColors={topicColors}
              mode={scatterMode}
              onPointClick={(id) => setSelectedPaperId((prev) => (prev === id ? null : id))}
              onLassoSelect={handleLassoSelect}
            />
            {/* Toolbar overlay — top-right inside the canvas */}
            <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-surface-container-low/80 backdrop-blur-sm rounded-lg p-0.5 border border-outline-variant/10">
              <button
                type="button"
                onClick={() => toggleMode("zoom")}
                className={`p-1.5 rounded-md transition-colors ${scatterMode === "zoom" ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-surface-container-high"}`}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => toggleMode("lasso")}
                className={`p-1.5 rounded-md transition-colors ${scatterMode === "lasso" ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-surface-container-high"}`}
              >
                <Lasso className="w-3.5 h-3.5" />
              </button>
              {lassoFills && (
                <button
                  type="button"
                  onClick={clearLasso}
                  className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-xs font-medium text-on-surface">散点图尚未生成</div>
            <p className="text-[11px] text-on-surface-variant max-w-xs leading-relaxed">
              需先运行 Embed 任务生成向量，然后提交 Project 任务计算 UMAP 投影。
            </p>
            <button
              type="button"
              onClick={projectJob.submit}
              disabled={projectJob.isPending}
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-mono font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              {projectJob.isPending ? "计算中…" : "生成投影"}
            </button>
          </div>
        )}
      </div>

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaperId(null)} />
    </div>
  );
}
