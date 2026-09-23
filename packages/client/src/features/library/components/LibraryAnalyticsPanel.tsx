import { useMemo, useState } from "react";
import type { ScholarProjection } from "../../../core/scholarTypes";
import type { PaperReference, TopicColorMap } from "../types";
import { PaperDetailPanel } from "./PaperDetailPanel";
import { ScatterPlot } from "./charts/ScatterPlot";

interface Props {
  papers: PaperReference[];
  projection?: ScholarProjection;
  topicColors: TopicColorMap;
}

/** The library as a map: one point per paper, coloured by its topic. */
export function LibraryAnalyticsPanel({ papers, projection, topicColors }: Props) {
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  const projectionBuilt = projection?.built ?? false;
  const projectionPoints = projection?.points ?? [];

  const selectedPaper = useMemo(
    () => (selectedPaperId ? (papers.find((p) => p.id === selectedPaperId) ?? null) : null),
    [selectedPaperId, papers],
  );

  return (
    <div aria-label="文献主题分析" className="flex flex-col flex-1 min-h-[480px] lg:min-h-0">
      <div className="relative flex-1 min-h-0 w-full bg-surface-container-low border border-outline-variant/10 rounded-lg overflow-hidden">
        {projectionBuilt ? (
          <ScatterPlot
            points={projectionPoints}
            activeIds={null}
            selectedId={selectedPaperId}
            topicColors={topicColors}
            onPointClick={(id) => setSelectedPaperId((prev) => (prev === id ? null : id))}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-xs font-medium text-on-surface">散点图尚未生成</div>
            <p className="text-[11px] text-on-surface-variant max-w-xs leading-relaxed">
              当前文献库没有保存的投影数据。已有主题和投影会自动显示。
            </p>
          </div>
        )}
      </div>

      <PaperDetailPanel paper={selectedPaper} onClose={() => setSelectedPaperId(null)} />
    </div>
  );
}
