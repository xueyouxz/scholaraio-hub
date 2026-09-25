import type { ProviderInfo, ProviderName } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { loggerFor } from "../logging/logger.js";
import { getAllProviders } from "../providers/index.js";
import type { AgentProvider } from "../providers/types.js";
import type { ProviderUsageLimitService } from "../services/ProviderUsageLimitService.js";

interface ProviderRouteDeps {
  providerUsageLimitService?: ProviderUsageLimitService;
  /** If non-empty, only these providers are exposed. */
  enabledProviders?: ProviderName[];
}

/** One provider's login and models; a provider that cannot say reports why. */
async function describe(provider: AgentProvider): Promise<ProviderInfo> {
  const base = {
    name: provider.name,
    displayName: provider.displayName,
    capabilities: provider.capabilities,
  };
  try {
    const [authStatus, models] = await Promise.all([
      provider.getAuthStatus(),
      provider.getAvailableModels(),
    ]);
    return {
      ...base,
      installed: authStatus.installed,
      authenticated: authStatus.authenticated,
      enabled: authStatus.enabled,
      expiresAt: authStatus.expiresAt?.toISOString(),
      user: authStatus.user,
      plan: authStatus.plan,
      models,
    };
  } catch (error) {
    loggerFor("providers").error({ err: error, provider: provider.name }, "Status unavailable");
    return {
      ...base,
      installed: false,
      authenticated: false,
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

  // Each provider asks its own CLI; one slow or failing CLI must not hold up the others.
  routes.get("/", async (c) =>
    c.json({ providers: await Promise.all(enabledProviders().map(describe)) }),
  );

  routes.get("/usage-limits", async (c) => {
    if (!deps.providerUsageLimitService) {
      return c.json({ usageLimits: [] });
    }

    const usageLimits = await deps.providerUsageLimitService.getUsageLimits(enabledProviders());
    return c.json({ usageLimits });
  });

  return routes;
}
