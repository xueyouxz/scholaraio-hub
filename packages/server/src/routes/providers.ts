import type { ProviderInfo } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { getAllProviders } from "../providers/index.js";
import type { ProviderUsageLimitService } from "../services/ProviderUsageLimitService.js";

interface ProviderRouteDeps {
  providerUsageLimitService?: ProviderUsageLimitService;
  /** If non-empty, only these provider names are exposed. */
  enabledProviders?: string[];
}

/**
 * Creates provider-related API routes.
 *
 * GET /api/providers - every enabled provider with its auth status and models
 * GET /api/providers/usage-limits - their usage-limit windows
 */
export function createProvidersRoutes(deps: ProviderRouteDeps = {}): Hono {
  const routes = new Hono();
  const enabledProviders = () => {
    const providers = getAllProviders();
    if (!deps.enabledProviders?.length) return providers;
    const enabled = new Set(deps.enabledProviders);
    return providers.filter((provider) => enabled.has(provider.name));
  };

  routes.get("/", async (c) => {
    const providers = enabledProviders();
    const providerInfos: ProviderInfo[] = [];

    for (const provider of providers) {
      const [authStatus, models] = await Promise.all([
        provider.getAuthStatus(),
        provider.getAvailableModels(),
      ]);
      providerInfos.push({
        name: provider.name,
        displayName: provider.displayName,
        installed: authStatus.installed,
        authenticated: authStatus.authenticated,
        enabled: authStatus.enabled,
        expiresAt: authStatus.expiresAt?.toISOString(),
        user: authStatus.user,
        plan: authStatus.plan,
        models,
        capabilities: provider.capabilities,
      });
    }

    return c.json({ providers: providerInfos });
  });

  routes.get("/usage-limits", async (c) => {
    if (!deps.providerUsageLimitService) {
      return c.json({ usageLimits: [] });
    }

    const usageLimits = await deps.providerUsageLimitService.getUsageLimits(enabledProviders());
    return c.json({ usageLimits });
  });

  return routes;
}
