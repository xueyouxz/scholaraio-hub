import type { SessionContextUsage } from "@scholaraio-hub/shared";
import { contextLabel, contextLevel, contextTitle } from "../../model/contextUsage";

const LEVEL_CLASS = {
  ok: "text-on-surface-variant",
  warn: "text-warning",
  danger: "text-error",
} as const;

/** A small ring filled by the share of the context window in use. */
export function ContextMeter({ usage }: { usage: SessionContextUsage }) {
  const used = usage.display === "used" ? usage.percent : 100 - usage.percent;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const title = contextTitle(usage);
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 whitespace-nowrap ${LEVEL_CLASS[contextLevel(usage)]}`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90">
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2.5"
        />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={`${(Math.min(Math.max(used, 0), 100) / 100) * circumference} ${circumference}`}
        />
      </svg>
      {contextLabel(usage)}
    </span>
  );
}
