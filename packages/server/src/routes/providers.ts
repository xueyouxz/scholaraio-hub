import type { ProviderInfo, ProviderName } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { success } from "../http.js";
import { loggerFor } from "../logging/logger.js";
import { getAllProviders } from "../providers/index.js";
import type { AgentProvider } from "../providers/types.js";
import type { ProviderUsageLimitService } from "../services/ProviderUsageLimitService.js";

interface ProviderRouteDeps {
  providerUsageLimitService?: ProviderUsageLimitService;
  /** If non-empty, only these providers are exposed. */
  enabledProviders?: ProviderName[];
}

/** 查询单个 Provider 的登录状态、模型和能力。 */
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

/** 创建 Provider 状态与用量查询接口。 */
export function createProvidersRoutes(deps: ProviderRouteDeps = {}): Hono {
  const routes = new Hono();
  const enabledProviders = () => {
    const providers = getAllProviders();
    if (!deps.enabledProviders?.length) return providers;
    const enabled = new Set(deps.enabledProviders);
    return providers.filter((provider) => enabled.has(provider.name));
  };

  // 并发查询各 Provider 的状态。
  routes.get("/", async (c) =>
    success(c, { providers: await Promise.all(enabledProviders().map(describe)) }),
  );

  routes.get("/usage-limits", async (c) => {
    if (!deps.providerUsageLimitService) {
      return success(c, { usageLimits: [] });
    }

    const usageLimits = await deps.providerUsageLimitService.getUsageLimits(enabledProviders());
    return success(c, { usageLimits });
  });

  return routes;
}
