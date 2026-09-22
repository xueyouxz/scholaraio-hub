import type { ProviderUsageLimits } from "@scholaraio-hub/shared";
import { useEffect, useState } from "react";
function formatResetTime(value?: string) {
  if (!value) return "Reset unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset unknown";
  return `Resets ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getUsageLimitBarColor(percent: number | null) {
  if (percent === null) return "var(--color-outline-variant)";
  const progress = Math.min(1, Math.max(0, percent / 100));
  const hue = 142 - progress * 101;
  const saturation = 57 - progress * 2;
  const lightness = 30 - progress * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function UsageLimitRow({
  label,
  usedPercent,
  resetsAt,
}: { label: string; usedPercent?: number; resetsAt?: string }) {
  const percent = usedPercent === undefined ? null : Math.round(usedPercent);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const barColor = getUsageLimitBarColor(percent);
  return (
    <span className="block px-4 pt-1.5 pb-1.5 first:pt-2 last:pb-3">
      <span className="flex items-center justify-between gap-4">
        <span className="block min-w-0">
          <span className="text-[12px] font-medium text-on-surface">{label}</span>
          <span className="block text-[10px] text-on-surface-variant/50 mt-0.5">
            {formatResetTime(resetsAt)}
          </span>
        </span>
        <span className="text-[11px] font-mono text-on-surface/70 shrink-0">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </span>
      <span className="block mt-1.5 h-1 rounded-full bg-surface-container-high overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out"
          style={{ width: `${width}%`, backgroundColor: barColor }}
        />
      </span>
    </span>
  );
}

export function UsageLimitBlock({
  limits,
  loading,
}: { limits: ProviderUsageLimits | null; loading: boolean }) {
  const [lastAvailableLimits, setLastAvailableLimits] = useState<ProviderUsageLimits | null>(null);

  useEffect(() => {
    if (limits?.available) {
      setLastAvailableLimits(limits);
    }
  }, [limits]);

  const displayLimits = limits?.available ? limits : lastAvailableLimits;
  const fiveHour = displayLimits?.windows.find((w) => w.name === "fiveHour");
  const weekly =
    displayLimits?.windows.find((w) => w.name === "weekly") ??
    displayLimits?.windows.find((w) => w.name === "weeklySonnet") ??
    displayLimits?.windows.find((w) => w.name === "weeklyOpus");
  return (
    <span className="block border-t border-outline-variant/10">
      {displayLimits ? (
        <span className="block divide-y divide-outline-variant/10">
          <UsageLimitRow
            label="5 hours"
            usedPercent={fiveHour?.usedPercent}
            resetsAt={fiveHour?.resetsAt}
          />
          <UsageLimitRow
            label="Weekly"
            usedPercent={weekly?.usedPercent}
            resetsAt={weekly?.resetsAt}
          />
        </span>
      ) : (
        <span className="block px-4 pt-2 pb-3 text-[11px] text-on-surface-variant/50">
          {loading ? "Loading…" : (limits?.error ?? "No usage limit data has been reported yet.")}
        </span>
      )}
    </span>
  );
}
