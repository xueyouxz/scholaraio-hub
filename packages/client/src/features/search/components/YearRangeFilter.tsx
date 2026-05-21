import { useCallback, useEffect, useRef } from "react";

export interface YearBin {
  year: number;
  count: number;
}

interface Props {
  bins: YearBin[];
  minYear: number;
  maxYear: number;
  value: [number, number];
  onChange: (range: [number, number]) => void;
}

const HIST_H = 56;

export function YearRangeFilter({ bins, minYear, maxYear, value, onChange }: Props) {
  const [low, high] = value;
  const histRef = useRef<SVGSVGElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragTarget = useRef<"low" | "high" | "brush" | null>(null);
  const brushStartYear = useRef<number>(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const totalYears = Math.max(maxYear - minYear, 1);
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const currentYear = new Date().getFullYear();

  const clampYear = useCallback(
    (y: number) => Math.max(minYear, Math.min(maxYear, y)),
    [minYear, maxYear],
  );
  const yearToFrac = (y: number) => (y - minYear) / totalYears;

  const fracToYear = useCallback(
    (frac: number) => clampYear(Math.round(minYear + Math.max(0, Math.min(1, frac)) * totalYears)),
    [clampYear, minYear, totalYears],
  );

  const getHistFrac = useCallback((clientX: number) => {
    const rect = histRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return (clientX - rect.left) / rect.width;
  }, []);

  const getTrackFrac = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return (clientX - rect.left) / rect.width;
  }, []);

  const handleHistMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const year = fracToYear(getHistFrac(e.clientX));
    brushStartYear.current = year;
    dragTarget.current = "brush";
    onChange([year, year]);
  };

  const handleThumbMouseDown = (which: "low" | "high") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragTarget.current = which;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragTarget.current) return;
      const [curLow, curHigh] = valueRef.current;

      if (dragTarget.current === "brush") {
        const year = fracToYear(getHistFrac(e.clientX));
        const start = brushStartYear.current;
        onChange([Math.min(start, year), Math.max(start, year)]);
      } else if (dragTarget.current === "low") {
        const year = fracToYear(getTrackFrac(e.clientX));
        onChange([Math.min(year, curHigh), curHigh]);
      } else {
        const year = fracToYear(getTrackFrac(e.clientX));
        onChange([curLow, Math.max(year, curLow)]);
      }
    };
    const onUp = () => {
      dragTarget.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [fracToYear, getHistFrac, getTrackFrac, onChange]);

  const quickTags: { label: string; range: [number, number] }[] = [
    { label: "全部", range: [minYear, maxYear] },
    {
      label: "近10年",
      range: [Math.max(minYear, currentYear - 10), Math.min(maxYear, currentYear)],
    },
    {
      label: "近5年",
      range: [Math.max(minYear, currentYear - 5), Math.min(maxYear, currentYear)],
    },
  ];

  const barW = bins.length > 0 ? 100 / bins.length : 0;
  const barGap = barW * 0.18;

  return (
    <div className="flex flex-col gap-3 select-none">
      {/* Histogram */}
      <svg
        ref={histRef}
        width="100%"
        height={HIST_H}
        className="cursor-col-resize overflow-visible"
        onMouseDown={handleHistMouseDown}
        style={{ display: "block" }}
      >
        <title>年份分布</title>
        {bins.map((bin, i) => {
          const x = (i / bins.length) * 100;
          const barH = Math.max(2, (bin.count / maxCount) * HIST_H);
          const inRange = bin.year >= low && bin.year <= high;
          return (
            <rect
              key={bin.year}
              x={`${x + barGap / 2}%`}
              y={HIST_H - barH}
              width={`${barW - barGap}%`}
              height={barH}
              fill={inRange ? "#005235" : "rgba(191,201,192,0.35)"}
              rx={1.5}
              style={{ transition: "fill 0.15s" }}
            />
          );
        })}
      </svg>

      {/* Dual-handle slider */}
      <div ref={trackRef} className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-outline-variant/25" />
        <div
          className="absolute h-1.5 rounded-full bg-primary"
          style={{
            left: `${yearToFrac(low) * 100}%`,
            width: `${(yearToFrac(high) - yearToFrac(low)) * 100}%`,
          }}
        />
        {/* Low thumb */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow-md cursor-grab active:cursor-grabbing z-10 hover:scale-110 transition-transform"
          style={{ left: `calc(${yearToFrac(low) * 100}% - 7px)` }}
          onMouseDown={handleThumbMouseDown("low")}
        />
        {/* High thumb */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow-md cursor-grab active:cursor-grabbing z-10 hover:scale-110 transition-transform"
          style={{ left: `calc(${yearToFrac(high) * 100}% - 7px)` }}
          onMouseDown={handleThumbMouseDown("high")}
        />
      </div>

      {/* Year labels */}
      <div className="flex justify-between">
        <span className="text-[10px] font-mono font-bold text-primary">{low}</span>
        <span className="text-[10px] font-mono font-bold text-primary">{high}</span>
      </div>

      {/* Quick tags */}
      <div className="flex gap-1.5 flex-wrap">
        {quickTags.map((tag) => {
          const isActive = low === tag.range[0] && high === tag.range[1];
          return (
            <button
              key={tag.label}
              type="button"
              onClick={() => onChange(tag.range)}
              className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-full border transition-colors ${
                isActive
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container text-on-surface-variant border-outline-variant/30 hover:border-primary/40 hover:text-primary"
              }`}
            >
              {tag.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
