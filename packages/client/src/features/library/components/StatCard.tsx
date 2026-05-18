import type { StatCardReference } from "../types";

const toneMap = {
  primary: "text-primary bg-primary-container/10",
  secondary: "text-secondary bg-secondary-container/10",
  tertiary: "text-tertiary bg-tertiary-container/10",
  error: "text-error bg-error-container/10",
};

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
    </article>
  );
}
