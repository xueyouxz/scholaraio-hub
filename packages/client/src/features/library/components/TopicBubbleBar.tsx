import { scaleSqrt } from "d3";
import { Layers } from "lucide-react";
import { useMemo } from "react";
import type { ScholarTopic } from "../../../core/scholarTypes";
import { useChartSize } from "../hooks/useChartSize";
import type { TopicColorMap } from "../types";

interface LassoData {
  ratio: number;
  count: number;
}

interface Props {
  built: boolean;
  topics: ScholarTopic[];
  topicColors: TopicColorMap;
  activeTopicIds: number[];
  lassoFills?: Map<number, LassoData> | null;
  onTopicSelect: (ids: number[]) => void;
  onBuildRequest?: () => void;
}

const CONTAINER_H = 120;
const MARGIN = { top: 12, right: 6, bottom: 6, left: 6 };
const BAR_GAP = 2;

export function TopicBarChart({
  built,
  topics,
  topicColors,
  activeTopicIds,
  lassoFills,
  onTopicSelect,
  onBuildRequest,
}: Props) {
  const { ref: barRef, width: svgW, height: svgH } = useChartSize(200, CONTAINER_H);

  const visibleTopics = useMemo(() => topics.filter((t) => t.id !== -1), [topics]);
  const maxCount = Math.max(...visibleTopics.map((t) => t.paperCount), 1);

  const innerW = Math.max(svgW - MARGIN.left - MARGIN.right, 0);
  const innerH = Math.max(svgH - MARGIN.top - MARGIN.bottom, 0);
  const barCount = visibleTopics.length;
  const barWidth = barCount > 0 ? Math.max((innerW - BAR_GAP * (barCount - 1)) / barCount, 3) : 3;
  const yScale = scaleSqrt().domain([0, maxCount]).range([0, innerH]);

  if (!built) {
    return (
      <div
        className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-lg flex items-center justify-center gap-3 px-5"
        style={{ height: CONTAINER_H }}
      >
        <Layers className="w-4 h-4 text-on-surface-variant" />
        <span className="text-xs text-on-surface-variant font-mono">主题模型尚未构建</span>
        {onBuildRequest && (
          <button
            type="button"
            onClick={onBuildRequest}
            className="px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-mono font-bold rounded-lg transition-colors"
          >
            构建
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="shrink-0 bg-surface-container-low border border-outline-variant/10 rounded-lg flex overflow-hidden"
      style={{ height: CONTAINER_H }}
    >
      <div ref={barRef} className="w-[62%] min-w-[240px] max-w-[420px] shrink-0">
        <svg width={svgW} height={svgH} aria-labelledby="topic-bar-chart-title">
          <title id="topic-bar-chart-title">主题分布</title>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {visibleTopics.map((topic, i) => {
              const color = topicColors.get(topic.id) ?? "#22c55e";
              const hasSelection = activeTopicIds.length > 0;
              const isActive = activeTopicIds.includes(topic.id);
              const isDimmed = hasSelection && !isActive;
              const hasLasso = lassoFills != null;
              const lassoData = hasLasso ? (lassoFills.get(topic.id) ?? null) : null;

              const bh = Math.max(yScale(topic.paperCount), 2);
              const x = i * (barWidth + BAR_GAP);
              const y = innerH - bh;

              const lassoFillH =
                lassoData && topic.paperCount > 0
                  ? Math.min(Math.max(yScale(lassoData.count), 1), bh)
                  : 0;

              return (
                <g key={topic.id}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={bh}
                    rx={1}
                    fill={hasLasso && !lassoData ? "#94a3b8" : color}
                    opacity={isDimmed ? 0.18 : hasLasso ? 0.2 : isActive ? 1 : 0.7}
                    className="cursor-pointer transition-opacity duration-150"
                    role="button"
                    tabIndex={0}
                    aria-label={`选择主题 T${topic.id}`}
                    onClick={() => {
                      if (isActive) {
                        onTopicSelect(activeTopicIds.filter((id) => id !== topic.id));
                      } else {
                        onTopicSelect(
                          activeTopicIds.length < 2 ? [...activeTopicIds, topic.id] : [topic.id],
                        );
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      if (isActive) {
                        onTopicSelect(activeTopicIds.filter((id) => id !== topic.id));
                      } else {
                        onTopicSelect(
                          activeTopicIds.length < 2 ? [...activeTopicIds, topic.id] : [topic.id],
                        );
                      }
                    }}
                  />
                  {lassoData && lassoFillH > 0 && (
                    <rect
                      x={x}
                      y={innerH - lassoFillH}
                      width={barWidth}
                      height={lassoFillH}
                      rx={1}
                      fill={color}
                      opacity={0.9}
                      className="pointer-events-none"
                    />
                  )}
                  {lassoData && (
                    <text
                      x={x + barWidth / 2}
                      y={Math.max(y - 2, 8)}
                      textAnchor="middle"
                      fontSize={8}
                      className="fill-on-surface-variant font-mono pointer-events-none"
                    >
                      {lassoData.count}
                    </text>
                  )}
                  {isActive && !lassoData && (
                    <text
                      x={x + barWidth / 2}
                      y={Math.max(y - 5, 9)}
                      textAnchor="middle"
                      fontSize={9}
                      className="fill-on-surface font-mono font-bold pointer-events-none"
                    >
                      {topic.paperCount}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
