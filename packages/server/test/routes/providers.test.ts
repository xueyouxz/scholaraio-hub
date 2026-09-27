import type { ProviderUsageLimits } from "@scholaraio-hub/shared";
import { describe, expect, it, vi } from "vitest";
import { handleApiError } from "../../src/http.js";
import { ProviderRegistry } from "../../src/providers/ProviderRegistry.js";
import { createProvidersRoutes } from "../../src/routes/providers.js";
import type { ProviderUsageLimitService } from "../../src/services/ProviderUsageLimitService.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

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
      providers: new ProviderRegistry([new WorkbenchProvider("claude")]),
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

  it("keeps the login status when the models cannot be listed", async () => {
    const provider = new WorkbenchProvider("claude");
    provider.getAvailableModels = async () => {
      throw new Error("model probe timed out");
    };
    const routes = createProvidersRoutes({
      providers: new ProviderRegistry([provider]),
      providerUsageLimitService: {} as ProviderUsageLimitService,
    });
    routes.onError(handleApiError);

    const response = await routes.request("/");

    const [info] = (await response.json()).data.providers;
    expect(info).toMatchObject({
      installed: true,
      authenticated: true,
      modelsError: "model probe timed out",
    });
    expect(info.error).toBeUndefined();
  });
});
