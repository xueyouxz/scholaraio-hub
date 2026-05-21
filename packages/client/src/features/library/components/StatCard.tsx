import { scaleLinear } from "d3";
import type { MiniChartBar, StatCardReference } from "../types";

const toneMap = {
  primary: "text-primary bg-primary-container/10",
  secondary: "text-secondary bg-secondary-container/10",
  tertiary: "text-tertiary bg-tertiary-container/10",
  error: "text-error bg-error-container/10",
};

const barColorMap: Record<string, string> = {
  primary: "#22c55e",
  secondary: "#3b82f6",
  tertiary: "#a78bfa",
  error: "#ef4444",
};

function MiniBarChart({ bars, tone }: { bars: MiniChartBar[]; tone: string }) {
  const color = barColorMap[tone] ?? barColorMap.primary;
  const xScale = scaleLinear().domain([0, 1]).range([0, 100]);

  return (
    <div className="flex flex-col gap-1 mt-3">
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-2">
          <span className="text-[10px] text-on-surface-variant truncate w-16 shrink-0">
            {bar.label}
          </span>
          <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${xScale(bar.ratio)}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-[10px] font-mono text-on-surface-variant w-7 text-right shrink-0">
            {bar.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniChartSkeleton() {
  return (
    <div className="flex flex-col gap-1 mt-3">
      {[60, 40, 25].map((w) => (
        <div key={w} className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-surface-container-high rounded" />
          <div className="flex-1 h-1.5 bg-surface-container-high rounded-full">
            <div className="h-full rounded-full bg-outline-variant/20" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatCard({ stat }: { stat: StatCardReference }) {
  const Icon = stat.icon;
  const tone = toneMap[stat.tone];
  const [textClass, bgClass] = tone.split(" ");

  return (
    <article className="bg-surface-container-low border border-outline-variant/10 rounded-xl p-6 transition-all hover:shadow-md">
      <div className="flex justify-between items-start mb-4">
        <Icon className={`w-6 h-6 ${textClass}`} />
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${tone}`}>
          {stat.badge}
        </span>
      </div>
      <div className={`font-mono text-3xl font-bold mb-1 ${textClass}`}>{stat.value}</div>
      <div className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
        {stat.label}
      </div>
      {"miniChart" in stat ? (
        stat.miniChart && stat.miniChart.length > 0 ? (
          <MiniBarChart bars={stat.miniChart} tone={stat.tone} />
        ) : (
          <MiniChartSkeleton />
        )
      ) : null}
    </article>
  );
}
