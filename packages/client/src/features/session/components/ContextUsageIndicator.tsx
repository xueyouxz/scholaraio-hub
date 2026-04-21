import type { ContextUsage } from "@scholaraio-hub/shared";

interface Props {
  usage?: ContextUsage;
  size?: number;
  showLabel?: boolean;
}

export function ContextUsageIndicator({ usage, size = 16, showLabel = true }: Props) {
  if (!usage) return null;

  const clamped = Math.min(100, Math.max(0, usage.percentage));
  const radius = size / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;

  const fill =
    clamped >= 90
      ? "var(--color-error, #ba1a1a)"
      : clamped >= 75
        ? "var(--color-warning, #7d5700)"
        : "var(--text-muted, #5e6b63)";

  const used = formatTokens(usage.inputTokens);
  const tooltip = usage.contextWindow
    ? `Context: ${clamped}% (${used} / ${formatTokens(usage.contextWindow)})`
    : `Context: ${clamped}% (${used})`;

  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-on-surface-variant"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-color)"
          strokeWidth="2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fill}
          strokeWidth="2"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {showLabel ? <span>{clamped}%</span> : null}
    </span>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}
