import { interpolateRgb } from "d3";
import { Layers } from "lucide-react";
import { useMemo } from "react";
import type { ScholarTopicSimilarity } from "../../../../core/api";
import { useChartSize } from "../../hooks/useChartSize";
import type { TopicColorMap } from "../../types";

interface Props {
  similarity?: ScholarTopicSimilarity;
  topicColors: TopicColorMap;
  activeTopicIds: number[];
  onTopicSelect: (ids: number[]) => void;
}

const MARGIN = 0;
const colorScale = interpolateRgb("#eff5f0", "#005235");

export function TopicSimilarityHeatmap({
  similarity,
  topicColors,
  activeTopicIds,
  onTopicSelect,
}: Props) {
  const { ref: containerRef, width, height } = useChartSize(320, 200);

  const topics = similarity?.topics ?? [];
  const matrix = similarity?.matrix ?? [];
  const built = similarity?.built ?? false;

  const cells = useMemo(() => {
    return topics.flatMap((rowTopic, row) =>
      topics
        .map((colTopic, col) => ({
          key: `${rowTopic.id}:${colTopic.id}`,
          row,
          col,
          rowTopic,
          colTopic,
          value: matrix[row]?.[col] ?? 0,
        }))
        .filter((cell) => cell.col <= cell.row),
    );
  }, [matrix, topics]);

  if (!built) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center gap-2 px-4">
        <Layers className="h-4 w-4 text-on-surface-variant" />
        <span className="text-xs font-mono text-on-surface-variant">
          主题模型构建后显示相似矩阵
        </span>
      </div>
    );
  }

  if (topics.length === 0 || matrix.length === 0) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center px-4">
        <span className="text-xs font-mono text-on-surface-variant">暂无主题相似度数据</span>
      </div>
    );
  }

  const innerW = Math.max(width - MARGIN * 2, 0);
  const innerH = Math.max(height - MARGIN * 2, 0);
  const cellSize = Math.max(Math.floor(Math.max(innerW, innerH) / topics.length), 4);
  const heatmapW = cellSize * topics.length;
  const heatmapH = cellSize * topics.length;
  const offsetX = MARGIN + Math.max((innerW - heatmapW) / 2, 0);
  const offsetY = MARGIN + Math.max((innerH - heatmapH) / 2, 0);

  return (
    <div ref={containerRef} className="relative h-full w-full select-none">
      <svg width={width} height={height} aria-labelledby="topic-similarity-heatmap-title">
        <title id="topic-similarity-heatmap-title">主题语义相似矩阵</title>
        <g transform={`translate(${offsetX},${offsetY})`}>
          <rect
            x={0}
            y={0}
            width={heatmapW}
            height={heatmapH}
            rx={4}
            className="fill-surface-container-lowest"
          />

          {cells.map(({ key, row, col, rowTopic, colTopic, value }) => {
            const hasSelection = activeTopicIds.length > 0;
            const isSelectedCell =
              activeTopicIds.includes(rowTopic.id) &&
              activeTopicIds.includes(colTopic.id) &&
              (activeTopicIds.length === 1 ? rowTopic.id === colTopic.id : true);
            const isDimmed = hasSelection && !isSelectedCell;
            const clamped = Math.max(0, Math.min(1, value));
            const x = col * cellSize;
            const y = row * cellSize;
            const selectCell = () => {
              if (isSelectedCell) {
                onTopicSelect([]);
              } else {
                onTopicSelect(
                  rowTopic.id === colTopic.id ? [rowTopic.id] : [rowTopic.id, colTopic.id],
                );
              }
            };

            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={Math.max(cellSize - 1, 1)}
                height={Math.max(cellSize - 1, 1)}
                rx={cellSize > 8 ? 1.5 : 0}
                fill={colorScale(clamped)}
                opacity={isDimmed ? 0.22 : 0.95}
                stroke={isSelectedCell ? "var(--color-primary)" : "none"}
                strokeWidth={isSelectedCell ? 1.5 : 0}
                role="button"
                tabIndex={0}
                aria-label={`选择主题 T${rowTopic.id} 和 T${colTopic.id} 的相似度`}
                className="cursor-pointer transition-opacity duration-150"
                onClick={selectCell}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectCell();
                  }
                }}
              />
            );
          })}

          <rect
            x={0}
            y={0}
            width={heatmapW}
            height={heatmapH}
            rx={4}
            fill="none"
            className="stroke-outline-variant/20"
          />
        </g>
      </svg>

      {activeTopicIds.length > 0 ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: offsetX + heatmapW * 0.35,
            top: offsetY + 16,
            width: heatmapW * 0.65 - 16,
            height: heatmapH * 0.65 - 16,
          }}
        >
          {activeTopicIds.length === 1 ? (
            <div className="absolute top-0 right-0 max-w-[90%] text-right text-[12px] leading-relaxed text-on-surface-variant">
              {topics.find((t) => t.id === activeTopicIds[0])?.keywords.join("  ")}
            </div>
          ) : (
            <>
              <div className="absolute top-0 right-0 text-[32px] font-mono font-bold text-primary leading-none">
                {Math.round(
                  (matrix[topics.findIndex((t) => t.id === activeTopicIds[0])]?.[
                    topics.findIndex((t) => t.id === activeTopicIds[1])
                  ] ?? 0) * 100,
                )}
                <span className="text-[16px] opacity-80 ml-0.5">%</span>
              </div>
              <div className="absolute left-[-10%] top-[-5%] w-[80%] text-[10px] leading-relaxed text-on-surface-variant line-clamp-3">
                <span className="font-bold mb-0.5">T{activeTopicIds[0]}：</span>
                {topics.find((t) => t.id === activeTopicIds[0])?.keywords.join(", ")}
              </div>
              <div className="absolute bottom-20 left-[30%] w-[80%] text-[10px] leading-relaxed text-on-surface-variant line-clamp-3">
                <span className="font-bold mb-0.5">T{activeTopicIds[1]}：</span>
                {topics.find((t) => t.id === activeTopicIds[1])?.keywords.join(", ")}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
