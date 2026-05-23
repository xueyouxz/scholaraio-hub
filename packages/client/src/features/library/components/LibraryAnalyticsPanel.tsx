import { useCallback, useMemo, useRef, useState } from "react";
import type { ScholarProjection, ScholarTopicsOverview } from "../../../core/api";
import { useJobMutation } from "../hooks/useJobMutation";
import type { PaperReference, TopicColorMap } from "../types";
import { PaperDetailPanel } from "./PaperDetailPanel";
import { TopicBarChart } from "./TopicBubbleBar";
import { ScatterPlot, type ScatterPlotRef } from "./charts/ScatterPlot";

interface Props {
  papers: PaperReference[];
  yearRange: [number, number] | null;
  topicsOverview?: ScholarTopicsOverview;
  projection?: ScholarProjection;
  topicColors: TopicColorMap;
  activeTopicIds: number[];
  onTopicSelect: (ids: number[]) => void;
}

export function LibraryAnalyticsPanel({
  papers,
  yearRange,
  topicsOverview,
  projection,
  topicColors,
  activeTopicIds,
  onTopicSelect,
}: Props) {
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [lassoFills, setLassoFills] = useState<Map<
    number,
    { ratio: number; count: number }
  > | null>(null);

  const topicsJob = useJobMutation("topics");
  const projectJob = useJobMutation("project");

  const scatterPlotRef = useRef<ScatterPlotRef>(null);

  const topics = topicsOverview?.topics ?? [];
  const topicsBuilt = topicsOverview?.built ?? false;
  const projectionBuilt = projection?.built ?? false;
  const projectionPoints = projection?.points ?? [];

  const activeIds = useMemo<Set<string> | null>(() => {
    const hasYear = yearRange !== null;
    const hasTopic = activeTopicIds.length > 0;

    if (!hasYear && !hasTopic) return null;

    let ids: Set<string> | null = null;

    if (hasYear && yearRange) {
      const [y0, y1] = yearRange;
      const byYear = new Set(papers.filter((p) => p.year >= y0 && p.year <= y1).map((p) => p.id));
      ids = byYear;
    }

    if (hasTopic) {
      const byTopic = new Set(
        projectionPoints.filter((pt) => activeTopicIds.includes(pt.topicId)).map((pt) => pt.id),
      );
      ids = ids ? new Set([...ids].filter((id) => byTopic.has(id))) : byTopic;
    }

    return ids ?? new Set();
  }, [yearRange, activeTopicIds, papers, projectionPoints]);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <TopicBarChart
        built={topicsBuilt}
        topics={topics}
        topicColors={topicColors}
        activeTopicIds={activeTopicIds}
        lassoFills={lassoFills}
        onTopicSelect={onTopicSelect}
        onBuildRequest={topicsJob.submit}
      />

      <div className="relative flex-1 min-h-0 w-full bg-surface-container-low border border-outline-variant/10 rounded-lg overflow-hidden">
        {projectionBuilt ? (
          <ScatterPlot
            ref={scatterPlotRef}
            points={projectionPoints}
            activeIds={activeIds}
            selectedId={selectedPaperId}
            topicColors={topicColors}
            onPointClick={(id) => setSelectedPaperId((prev) => (prev === id ? null : id))}
            onLassoSelect={handleLassoSelect}
            onReset={() => setLassoFills(null)}
          />
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
