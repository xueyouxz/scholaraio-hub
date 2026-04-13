import type React from "react";
import type { StatCardReference } from "../types/ui";

interface StatCardProps {
  stat: StatCardReference;
}

const toneMap = {
  primary: "text-primary bg-primary-container/10",
  secondary: "text-secondary bg-secondary-container/10",
  tertiary: "text-tertiary bg-tertiary-container/10",
  error: "text-error bg-error-container/10",
};

const StatCard: React.FC<StatCardProps> = ({ stat }) => {
  const Icon = stat.icon;
  const tone = toneMap[stat.tone];

  return (
    <article className="bg-surface-container-low border border-outline-variant/10 rounded-xl p-6 transition-all hover:shadow-md group">
      <div className="flex justify-between items-start mb-4">
        <Icon className={`w-6 h-6 ${tone.split(" ")[0]}`} />
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${tone}`}>
          {stat.badge}
        </span>
      </div>
      <div className={`font-mono text-3xl font-bold mb-1 ${tone.split(" ")[0]}`}>{stat.value}</div>
      <div className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
        {stat.label}
      </div>
    </article>
  );
};

export default StatCard;
