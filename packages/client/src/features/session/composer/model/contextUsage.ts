import type { SessionContextUsage } from "@scholaraio-hub/shared";

export type ContextLevel = "ok" | "warn" | "danger";

/** How close the window is to full, whichever direction the provider reports. */
export function contextLevel(usage: SessionContextUsage): ContextLevel {
  const used = usage.display === "used" ? usage.percent : 100 - usage.percent;
  return used >= 90 ? "danger" : used >= 75 ? "warn" : "ok";
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** The pill text in the provider's own phrasing: share used, or share left. */
export function contextLabel(usage: SessionContextUsage): string {
  return usage.display === "used" ? `${usage.percent}%` : `${usage.percent}% 剩余`;
}

export function contextTitle(usage: SessionContextUsage): string {
  const tokens = `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)} tokens`;
  const head =
    usage.display === "used"
      ? `上下文已用 ${usage.percent}%（${tokens}）`
      : `上下文剩余 ${usage.percent}%（${tokens}）`;
  return usage.autoCompactThreshold
    ? `${head}，达到 ${formatTokens(usage.autoCompactThreshold)} 时自动压缩`
    : head;
}
