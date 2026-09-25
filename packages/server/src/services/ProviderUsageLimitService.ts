import type {
  ProviderName,
  ProviderUsageLimitWindow,
  ProviderUsageLimitWindowName,
  ProviderUsageLimits,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import type { AgentProvider } from "../providers/types.js";

function mergeLimits(
  previous: ProviderUsageLimits | undefined,
  next: ProviderUsageLimits,
): ProviderUsageLimits {
  if (!previous) return next;

  const byName = new Map<ProviderUsageLimitWindowName, ProviderUsageLimitWindow>();
  for (const window of previous.windows) {
    byName.set(window.name, window);
  }
  for (const window of next.windows) {
    const before = byName.get(window.name);
    // Claude's rate_limit_event rarely carries utilization; a report without a
    // percentage for the same reset keeps the percentage fetched earlier.
    const sameReset =
      window.resetsAtEpochSeconds === undefined ||
      before?.resetsAtEpochSeconds === undefined ||
      Math.abs(window.resetsAtEpochSeconds - before.resetsAtEpochSeconds) < 60;
    byName.set(
      window.name,
      window.usedPercent === undefined && before?.usedPercent !== undefined && sameReset
        ? { ...window, usedPercent: before.usedPercent }
        : window,
    );
  }

  return {
    ...previous,
    ...next,
    windows: [...byName.values()],
  };
}

/**
 * How long a fetched answer stands before the provider is asked again.
 *
 * Claude's usage endpoint rate-limits polling, and a settings page that
 * re-mounts is not news: within this window every reader gets the same answer.
 */
const FRESH_MS = 5 * 60 * 1000;

export class ProviderUsageLimitService {
  private readonly cache = new Map<ProviderName, ProviderUsageLimits>();
  /** When each cached entry was fetched from the provider, not reported to us. */
  private readonly fetchedAt = new Map<ProviderName, number>();
  /** One fetch per provider at a time; concurrent readers share its result. */
  private readonly inFlight = new Map<ProviderName, Promise<ProviderUsageLimits>>();

  record(limits: ProviderUsageLimits): void {
    this.cache.set(limits.provider, mergeLimits(this.cache.get(limits.provider), limits));
  }

  async getUsageLimits(providers: AgentProvider[]): Promise<ProviderUsageLimits[]> {
    return Promise.all(providers.map((provider) => this.forProvider(provider)));
  }

  private async forProvider(provider: AgentProvider): Promise<ProviderUsageLimits> {
    const cached = this.cache.get(provider.name);
    if (!provider.getUsageLimits) {
      return (
        cached ?? {
          provider: provider.name,
          available: false,
          windows: [],
          error: "用量数据要等这个工具自己报告后才有。",
        }
      );
    }
    const age = Date.now() - (this.fetchedAt.get(provider.name) ?? Number.NEGATIVE_INFINITY);
    if (cached?.available && age < FRESH_MS) return cached;
    const pending = this.inFlight.get(provider.name);
    if (pending) return pending;
    const fetching = this.fetch(provider);
    this.inFlight.set(provider.name, fetching);
    try {
      return await fetching;
    } finally {
      this.inFlight.delete(provider.name);
    }
  }

  private async fetch(provider: AgentProvider): Promise<ProviderUsageLimits> {
    try {
      const limits = await provider.getUsageLimits?.();
      if (!limits) throw new Error("用量数据暂不可用。");
      this.record(limits);
      this.fetchedAt.set(provider.name, Date.now());
      return limits;
    } catch (error) {
      loggerFor("usage-limits").warn({ err: error, provider: provider.name }, "Usage fetch failed");
      // A throttled or failed poll is not evidence that the last answer was
      // wrong, so keep showing it rather than blanking the card.
      const cached = this.cache.get(provider.name);
      if (cached?.available) return cached;
      return {
        provider: provider.name,
        available: false,
        windows: [],
        error: error instanceof Error ? error.message : "无法获取用量数据。",
      };
    }
  }
}
