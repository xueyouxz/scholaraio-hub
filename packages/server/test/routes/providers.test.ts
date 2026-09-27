import type { ProviderUsageLimits } from "@scholaraio-hub/shared";
import { describe, expect, it, vi } from "vitest";
import { handleApiError } from "../../src/http.js";
import { createProvidersRoutes } from "../../src/routes/providers.js";
import type { ProviderUsageLimitService } from "../../src/services/ProviderUsageLimitService.js";

describe("Providers Routes", () => {
  it("returns provider usage limits from the usage limit service", async () => {
    const usageLimits: ProviderUsageLimits[] = [
      {
        provider: "claude",
        available: true,
        updatedAt: "2026-05-20T00:00:00.000Z",
        windows: [
          {
            name: "fiveHour",
            label: "5 hours",
            usedPercent: 42,
            resetsAt: "2026-05-20T05:00:00.000Z",
            resetsAtEpochSeconds: 1_777_531_200,
            source: "claude-sdk-rate-limit-event",
          },
        ],
      },
    ];
    const getUsageLimits = vi.fn(async () => usageLimits);
    const routes = createProvidersRoutes({
      enabledProviders: ["claude"],
      providerUsageLimitService: {
        getUsageLimits,
      } as unknown as ProviderUsageLimitService,
    });
    routes.onError(handleApiError);

    const response = await routes.request("/usage-limits");

    expect(response.status).toBe(200);
    await expect(response.json().then((body) => body.data)).resolves.toEqual({ usageLimits });
    expect(getUsageLimits).toHaveBeenCalledWith([expect.objectContaining({ name: "claude" })]);
  });
});
