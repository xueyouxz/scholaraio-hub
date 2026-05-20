import type {
  ProviderName,
  ProviderUsageLimitSource,
  ProviderUsageLimitWindow,
  ProviderUsageLimitWindowName,
  ProviderUsageLimits,
} from "@scholaraio-hub/shared";
import type { AgentProvider } from "../sdk/providers/types.js";
import type { SDKMessage } from "../sdk/types.js";

const FIVE_HOUR_MINUTES = 5 * 60;
const WEEKLY_MINUTES = 7 * 24 * 60;

export interface ProviderUsageLimitsProvider extends AgentProvider {
  getUsageLimits?: () => Promise<ProviderUsageLimits>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

function epochSecondsToIso(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

function isoToEpochSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return undefined;
  return Math.floor(millis / 1000);
}

function labelForWindow(name: ProviderUsageLimitWindowName): string {
  switch (name) {
    case "fiveHour":
      return "5 hours";
    case "weekly":
      return "Weekly";
    case "weeklyOpus":
      return "Weekly Opus";
    case "weeklySonnet":
      return "Weekly Sonnet";
    case "overage":
      return "Overage";
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}

function mapClaudeWindowName(value: unknown): ProviderUsageLimitWindowName {
  switch (value) {
    case "five_hour":
      return "fiveHour";
    case "seven_day":
      return "weekly";
    case "seven_day_opus":
      return "weeklyOpus";
    case "seven_day_sonnet":
      return "weeklySonnet";
    case "overage":
      return "overage";
    default:
      return "unknown";
  }
}

export function normalizeClaudeRateLimitEvent(
  provider: ProviderName,
  message: SDKMessage,
): ProviderUsageLimits | null {
  if (message.type !== "rate_limit_event") return null;

  const info = asRecord(message.rate_limit_info);
  if (!info) return null;

  const name = mapClaudeWindowName(info.rateLimitType);
  const resetsAt =
    typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt) ? info.resetsAt : undefined;
  const status =
    info.status === "allowed" || info.status === "allowed_warning" || info.status === "rejected"
      ? info.status
      : "unknown";
  const utilization =
    typeof info.utilization === "number" && Number.isFinite(info.utilization)
      ? info.utilization
      : undefined;
  const updatedAt = new Date().toISOString();

  const window: ProviderUsageLimitWindow = {
    name,
    label: labelForWindow(name),
    usedPercent: normalizePercent(utilization),
    resetsAt: epochSecondsToIso(resetsAt),
    resetsAtEpochSeconds: resetsAt,
    status,
    source: "claude-sdk-rate-limit-event",
  };

  return {
    provider,
    available: true,
    updatedAt,
    windows: [window],
  };
}

export function normalizeClaudeOAuthUsage(
  provider: ProviderName,
  payload: unknown,
): ProviderUsageLimits | null {
  const record = asRecord(payload);
  if (!record) return null;

  const windows: ProviderUsageLimitWindow[] = [];
  const mappings: Array<[string, ProviderUsageLimitWindowName]> = [
    ["five_hour", "fiveHour"],
    ["seven_day", "weekly"],
    ["seven_day_opus", "weeklyOpus"],
    ["seven_day_sonnet", "weeklySonnet"],
  ];

  for (const [key, name] of mappings) {
    const limit = asRecord(record[key]);
    if (!limit) continue;

    const utilization =
      typeof limit.utilization === "number" && Number.isFinite(limit.utilization)
        ? limit.utilization
        : undefined;
    const resetsAt = typeof limit.resets_at === "string" ? limit.resets_at : undefined;

    if (utilization === undefined && resetsAt === undefined) continue;

    windows.push({
      name,
      label: labelForWindow(name),
      usedPercent: normalizePercent(utilization),
      resetsAt: resetsAt ? new Date(resetsAt).toISOString() : undefined,
      resetsAtEpochSeconds: isoToEpochSeconds(resetsAt),
      source: "claude-oauth-usage-api",
    });
  }

  if (windows.length === 0) return null;

  return {
    provider,
    available: true,
    updatedAt: new Date().toISOString(),
    windows,
  };
}

function mapCodexWindowName(windowMinutes: number | undefined): ProviderUsageLimitWindowName {
  if (windowMinutes === FIVE_HOUR_MINUTES) return "fiveHour";
  if (windowMinutes === WEEKLY_MINUTES) return "weekly";
  return "unknown";
}

export function normalizeCodexRateLimits(
  provider: ProviderName,
  payload: unknown,
  source: ProviderUsageLimitSource = "codex-app-server",
): ProviderUsageLimits | null {
  const record = asRecord(payload);
  if (!record) return null;

  const byLimitId = asRecord(record.rateLimitsByLimitId);
  const codexLimit = byLimitId ? asRecord(byLimitId.codex) : null;
  const rateLimits = asRecord(record.rateLimits);
  const sourceRecord = codexLimit ?? rateLimits ?? record;
  const windows: ProviderUsageLimitWindow[] = [];

  for (const key of ["primary", "secondary"] as const) {
    const limit = asRecord(sourceRecord[key]);
    if (!limit) continue;

    const usedPercent =
      typeof limit.usedPercent === "number"
        ? limit.usedPercent
        : typeof limit.used_percent === "number"
          ? limit.used_percent
          : undefined;
    const windowMinutes =
      typeof limit.windowDurationMins === "number"
        ? limit.windowDurationMins
        : typeof limit.window_minutes === "number"
          ? limit.window_minutes
          : undefined;
    const resetsAt =
      typeof limit.resetsAt === "number"
        ? limit.resetsAt
        : typeof limit.resets_at === "number"
          ? limit.resets_at
          : undefined;

    if (usedPercent === undefined && windowMinutes === undefined && resetsAt === undefined) {
      continue;
    }

    const name = mapCodexWindowName(windowMinutes);
    windows.push({
      name,
      label: labelForWindow(name),
      usedPercent: normalizePercent(usedPercent),
      resetsAt: epochSecondsToIso(resetsAt),
      resetsAtEpochSeconds: resetsAt,
      windowMinutes,
      source,
    });
  }

  if (windows.length === 0) return null;

  return {
    provider,
    available: true,
    updatedAt: new Date().toISOString(),
    windows,
  };
}

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
    byName.set(window.name, window);
  }

  return {
    ...previous,
    ...next,
    windows: [...byName.values()],
  };
}

export class ProviderUsageLimitService {
  private readonly cache = new Map<ProviderName, ProviderUsageLimits>();

  recordSDKMessage(provider: ProviderName, message: SDKMessage): void {
    const limits =
      provider === "claude" || provider === "claude-ollama"
        ? normalizeClaudeRateLimitEvent(provider, message)
        : null;
    if (!limits) return;
    this.record(limits);
  }

  record(limits: ProviderUsageLimits): void {
    this.cache.set(limits.provider, mergeLimits(this.cache.get(limits.provider), limits));
  }

  async getUsageLimits(providers: ProviderUsageLimitsProvider[]): Promise<ProviderUsageLimits[]> {
    const results: ProviderUsageLimits[] = [];

    for (const provider of providers) {
      if (provider.getUsageLimits) {
        try {
          const limits = await provider.getUsageLimits();
          this.record(limits);
          results.push(limits);
          continue;
        } catch (error) {
          const cached = this.cache.get(provider.name);
          if (cached) {
            results.push(cached);
            continue;
          }
          results.push({
            provider: provider.name,
            available: false,
            windows: [],
            error: error instanceof Error ? error.message : "Failed to fetch provider usage limits",
          });
          continue;
        }
      }

      const cached = this.cache.get(provider.name);
      results.push(
        cached ?? {
          provider: provider.name,
          available: false,
          windows: [],
          error: "Usage limits are not available until the provider reports them.",
        },
      );
    }

    return results;
  }
}
