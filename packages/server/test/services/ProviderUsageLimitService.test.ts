import { describe, expect, it } from "vitest";
import type { AgentProvider } from "../../src/providers/types.js";
import { normalizeCodexRateLimits } from "../../src/providers/usage-limits.js";
import { ProviderUsageLimitService } from "../../src/services/ProviderUsageLimitService.js";

const RESET = 1_790_242_200;

function provider(usedPercent: number): AgentProvider {
  return {
    name: "claude",
    getUsageLimits: async () => ({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          label: "5 hours",
          usedPercent,
          resetsAtEpochSeconds: RESET - 1,
          source: "claude-oauth-usage-api",
        },
      ],
    }),
  } as unknown as AgentProvider;
}

describe("ProviderUsageLimitService", () => {
  it("keeps a fetched percentage when a later report for the same reset has none", async () => {
    const service = new ProviderUsageLimitService();
    const claude = provider(42);
    await service.getUsageLimits([claude]);

    service.record({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          label: "5 hours",
          resetsAtEpochSeconds: RESET,
          status: "allowed",
          source: "claude-sdk-rate-limit-event",
        },
      ],
    });

    const [limits] = await service.getUsageLimits([claude]);
    expect(limits?.windows[0]).toMatchObject({ usedPercent: 42, status: "allowed" });
  });

  it("drops the old percentage once the window has reset", async () => {
    const service = new ProviderUsageLimitService();
    await service.getUsageLimits([provider(42)]);

    service.record({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          label: "5 hours",
          resetsAtEpochSeconds: RESET + 5 * 3600,
          source: "claude-sdk-rate-limit-event",
        },
      ],
    });

    const [limits] = await service.getUsageLimits([{ name: "claude" } as unknown as AgentProvider]);
    expect(limits?.windows[0]?.usedPercent).toBeUndefined();
  });

  it("reads Codex's whole percentages as they are: 1 means 1%, not 100%", () => {
    const limits = normalizeCodexRateLimits("codex", {
      rateLimits: { primary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: RESET } },
    });
    expect(limits?.windows[0]).toMatchObject({ name: "weekly", usedPercent: 1 });
  });
});
