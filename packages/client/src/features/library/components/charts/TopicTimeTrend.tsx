import { scaleLinear } from "d3";
import { useMemo, useState } from "react";
import type { ScholarProjectionPoint, ScholarTopic } from "../../../../core/api";
import { useChartSize } from "../../hooks/useChartSize";
import type { TopicColorMap } from "../../types";

interface YearCount {
  year: number;
  count: number;
}

interface Props {
  built: boolean;
  topics: ScholarTopic[];
  points: ScholarProjectionPoint[];
  topicColors: TopicColorMap;
  yearCounts: YearCount[];
  yearRange: [number, number] | null;
  activeTopicIds: number[];
}

interface HoverState {
  topicId: number;
  year: number;
  count: number;
  keywords: string[];
  x: number;
  y: number;
}

const MARGIN = { top: 20, right: 8, bottom: 18, left: 8 };
const MAX_TOPICS = 10;

export function TopicTimeTrend({
  built,
  topics,
  points,
  topicColors,
  yearCounts,
  yearRange,
  activeTopicIds,
}: Props) {
  const { ref: containerRef, width, height } = useChartSize(320, 260);
  const [hovered, setHovered] = useState<HoverState | null>(null);

  const { visibleTopics, countsByKey, globalMax } = useMemo(() => {
    const vt = topics
      .filter((t) => t.id !== -1)
      .slice()
      .sort((a, b) => b.paperCount - a.paperCount)
      .slice(0, MAX_TOPICS);
    const visibleIds = new Set(vt.map((t) => t.id));
    const cbk = new Map<string, number>();
    let gmax = 0;
    for (const pt of points) {
      if (!visibleIds.has(pt.topicId) || pt.year <= 1900) continue;
      const key = `${pt.topicId}:${pt.year}`;
      const next = (cbk.get(key) ?? 0) + 1;
      cbk.set(key, next);
      if (next > gmax) gmax = next;
    }
    return { visibleTopics: vt, countsByKey: cbk, globalMax: gmax };
  }, [points, topics]);

  const years = useMemo(() => yearCounts.map((d) => d.year).sort((a, b) => a - b), [yearCounts]);

  const fallbackYear = new Date().getFullYear();
  const minYear = years.length > 0 ? Math.min(...years) : fallbackYear - 5;
  const maxYear = years.length > 0 ? Math.max(...years) : fallbackYear;

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const innerH = Math.max(height - MARGIN.top - MARGIN.bottom, 0);

  const xScale = scaleLinear().domain([minYear, maxYear]).range([0, innerW]);
  const yScale = scaleLinear()
    .domain([0, Math.max(globalMax, 1)])
    .range([innerH, 0]);

  const tickStep = Math.max(1, Math.ceil(years.length / 6));
  const xTicks = years.filter((_, i) => i % tickStep === 0);

  if (!built) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center px-4">
        <span className="text-xs font-mono text-on-surface-variant">
          投影生成后显示主题时间趋势
        </span>
      </div>
    );
  }

  if (visibleTopics.length === 0 || years.length === 0) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center px-4">
        <span className="text-xs font-mono text-on-surface-variant">暂无主题年份数据</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      <svg width={width} height={height} aria-labelledby="topic-time-trend-title">
        <title id="topic-time-trend-title">主题时间趋势</title>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Lines and dots */}
          {visibleTopics.map((topic) => {
            const color = topicColors.get(topic.id) ?? "#22c55e";
            const hasSelection = activeTopicIds.length > 0;
            const isActive = activeTopicIds.includes(topic.id);
            const isDimmed = hasSelection && !isActive;

            const linePoints = years
              .map((year) => ({
                year,
                count: countsByKey.get(`${topic.id}:${year}`) ?? 0,
              }))
              .filter((p) => p.count > 0);

            if (linePoints.length === 0) return null;

            const pathD = linePoints
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.year)} ${yScale(p.count)}`)
              .join(" ");

            return (
              <g key={topic.id} opacity={isDimmed ? 0.15 : 1}>
                {/* Wider invisible hit area for hovering the line */}
                <path d={pathD} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 2 : 1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="pointer-events-none transition-opacity duration-150"
                />
                {linePoints.map((p) => {
                  const isHov = hovered?.topicId === topic.id && hovered?.year === p.year;
                  return (
                    <circle
                      key={p.year}
                      cx={xScale(p.year)}
                      cy={yScale(p.count)}
                      r={isHov ? 4 : 2.5}
                      fill={color}
                      className="transition-all duration-100"
                      onMouseEnter={(e) => {
                        const svgEl = e.currentTarget.ownerSVGElement as SVGSVGElement;
                        const rect = svgEl.getBoundingClientRect();
                        setHovered({
                          topicId: topic.id,
                          year: p.year,
                          count: p.count,
                          keywords: topic.keywords.slice(0, 3),
                          x: rect.left + MARGIN.left + xScale(p.year),
                          y: rect.top + MARGIN.top + yScale(p.count),
                        });
                      }}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
                {isActive &&
                  linePoints.map((p) => (
                    <text
                      key={`${p.year}-count`}
                      x={xScale(p.year)}
                      y={Math.max(yScale(p.count) - 7, 9)}
                      textAnchor="middle"
                      fontSize={9}
                      className="fill-on-surface font-mono font-bold pointer-events-none"
                    >
                      {p.count}
                    </text>
                  ))}
              </g>
            );
          })}

          {/* Year range masks — rendered after lines so they overlay */}
          {yearRange && xScale(yearRange[0]) > 0 && (
            <rect
              x={0}
              y={0}
              width={xScale(yearRange[0])}
              height={innerH}
              className="fill-surface-container"
              opacity={0.65}
              pointerEvents="none"
            />
          )}
          {yearRange && xScale(yearRange[1]) < innerW && (
            <rect
              x={xScale(yearRange[1])}
              y={0}
              width={innerW - xScale(yearRange[1])}
              height={innerH}
              className="fill-surface-container"
              opacity={0.65}
              pointerEvents="none"
            />
          )}

          {/* X-axis year labels */}
          <g transform={`translate(0,${innerH})`}>
            {xTicks.map((year) => (
              <text
                key={year}
                x={xScale(year)}
                y={14}
                textAnchor="middle"
                fontSize={9}
                className="fill-on-surface-variant font-mono"
              >
                {year}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {hovered && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-outline-variant/20 bg-surface-container-high px-2 py-1 text-[11px] text-on-surface shadow-md"
          style={{
            left: hovered.x,
            top: hovered.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <span className="font-mono text-on-surface-variant">T{hovered.topicId}</span>
          <span className="mx-1">·</span>
          <span>{hovered.year}</span>
          <span className="mx-1">·</span>
          <span className="font-mono">{hovered.count}</span>
          {hovered.keywords.length > 0 && (
            <>
              <span className="mx-1">·</span>
              <span className="text-on-surface-variant">{hovered.keywords.join(", ")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
