import { type D3BrushEvent, axisBottom, brushX, scaleLinear, select } from "d3";
import { useEffect, useRef } from "react";
import { useChartSize } from "../../hooks/useChartSize";

interface YearCount {
  year: number;
  count: number;
}

interface Props {
  yearCounts: YearCount[];
  yearRange: [number, number] | null;
  onBrush: (range: [number, number] | null) => void;
}

const MARGIN = { top: 8, right: 8, bottom: 24, left: 8 };

export function YearHistogram({ yearCounts, yearRange, onBrush }: Props) {
  const { ref: containerRef, width, height } = useChartSize(400, 120);
  const svgRef = useRef<SVGSVGElement>(null);
  const brushRef = useRef<ReturnType<typeof brushX> | null>(null);
  const programmaticBrush = useRef(false);

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const innerH = Math.max(height - MARGIN.top - MARGIN.bottom, 0);

  const years = yearCounts.map((d) => d.year);
  const minYear = years.length > 0 ? Math.min(...years) : new Date().getFullYear() - 5;
  const maxYear = years.length > 0 ? Math.max(...years) : new Date().getFullYear();

  const xScale = scaleLinear()
    .domain([minYear - 0.5, maxYear + 0.5])
    .range([0, innerW]);
  const maxCount = Math.max(...yearCounts.map((d) => d.count), 1);
  const yScale = scaleLinear().domain([0, maxCount]).range([innerH, 0]);

  const barWidth =
    yearCounts.length > 1 ? Math.max(xScale(minYear + 1) - xScale(minYear) - 2, 2) : 20;

  // Set up brush
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || innerW <= 0 || innerH <= 0) return;

    const brushGroup = select(svg).select<SVGGElement>(".brush-group");
    const brush = brushX()
      .extent([
        [0, 0],
        [innerW, innerH],
      ])
      .on("end", (event: D3BrushEvent<unknown>) => {
        if (programmaticBrush.current) {
          programmaticBrush.current = false;
          return;
        }
        if (!event.selection) {
          onBrush(null);
          return;
        }
        const [x0, x1] = event.selection as [number, number];
        const y0 = Math.round(xScale.invert(x0));
        const y1 = Math.round(xScale.invert(x1));
        onBrush([Math.min(y0, y1), Math.max(y0, y1)]);
      });

    brushRef.current = brush;
    brushGroup.call(brush);

    const axisG = select(svg).select<SVGGElement>(".axis-bottom");
    axisG.call(
      axisBottom(xScale)
        .ticks(Math.min(yearCounts.length, 8))
        .tickFormat((d) => String(d))
        .tickSize(4),
    );
    axisG.select(".domain").remove();
    axisG.selectAll("text").attr("font-size", "10").attr("fill", "currentColor");
    axisG.selectAll(".tick line").attr("stroke", "currentColor").attr("opacity", "0.3");
  }, [innerW, innerH, xScale, onBrush, yearCounts.length]);

  // Sync brush selection when yearRange prop changes
  useEffect(() => {
    const svg = svgRef.current;
    const brush = brushRef.current;
    if (!svg || !brush || innerW <= 0) return;

    const brushGroup = select(svg).select<SVGGElement>(".brush-group");
    programmaticBrush.current = true;
    if (yearRange) {
      const x0 = xScale(yearRange[0] - 0.5);
      const x1 = xScale(yearRange[1] + 0.5);
      brushGroup.call(brush.move, [x0, x1]);
    } else {
      brushGroup.call(brush.clear);
    }
  }, [yearRange, xScale, innerW]);

  if (yearCounts.length === 0) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <span className="text-xs text-on-surface-variant">暂无年份数据</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full select-none">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="text-on-surface-variant/40"
        aria-hidden="true"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {yearCounts.map((d) => {
            const x = xScale(d.year) - barWidth / 2;
            const barH = innerH - yScale(d.count);
            const inRange = !yearRange || (d.year >= yearRange[0] && d.year <= yearRange[1]);

            return (
              <rect
                key={d.year}
                x={x}
                y={yScale(d.count)}
                width={barWidth}
                height={Math.max(barH, 0)}
                rx={2}
                className={`transition-opacity duration-200 fill-primary ${inRange ? "" : "opacity-20"}`}
              />
            );
          })}

          <g
            className="axis-bottom text-on-surface-variant/40"
            transform={`translate(0,${innerH})`}
          />
          <g className="brush-group" style={{ cursor: "crosshair" }} />
        </g>
      </svg>
    </div>
  );
}
