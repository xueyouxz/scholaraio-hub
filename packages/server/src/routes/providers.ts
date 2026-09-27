import type { ProviderInfo } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { type AppEnv, success } from "../http.js";
import { loggerFor } from "../logging/logger.js";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import type { AgentProvider } from "../providers/types.js";
import type { ProviderUsageLimitService } from "../services/ProviderUsageLimitService.js";

interface ProviderRouteDeps {
  /** 已启用的 Provider；只展示这些。 */
  providers: ProviderRegistry;
  providerUsageLimitService: ProviderUsageLimitService;
}

/** 查询单个 Provider 的登录状态、模型和能力。 */
async function describe(provider: AgentProvider): Promise<ProviderInfo> {
  const base = {
    name: provider.name,
    displayName: provider.displayName,
    capabilities: provider.capabilities,
  };
  // Read apart: a model listing that fails or times out must not hide the login.
  const [auth, models] = await Promise.allSettled([
    provider.getAuthStatus(),
    provider.getAvailableModels(),
  ]);
  if (auth.status === "rejected") {
    loggerFor("providers").error(
      { err: auth.reason, provider: provider.name },
      "Status unavailable",
    );
    return {
      ...base,
      installed: false,
      authenticated: false,
      enabled: false,
      error: errorMessage(auth.reason),
    };
  }
  const authStatus = auth.value;
  if (models.status === "rejected")
    loggerFor("providers").error(
      { err: models.reason, provider: provider.name },
      "Models unavailable",
    );
  return {
    ...base,
    installed: authStatus.installed,
    authenticated: authStatus.authenticated,
    enabled: authStatus.enabled,
    expiresAt: authStatus.expiresAt?.toISOString(),
    user: authStatus.user,
    plan: authStatus.plan,
    ...(models.status === "fulfilled"
      ? { models: models.value }
      : { modelsError: errorMessage(models.reason) }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建 Provider 状态与用量查询接口。 */
export function createProvidersRoutes(deps: ProviderRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const enabledProviders = () => deps.providers.list();

  // 并发查询各 Provider 的状态。
  routes.get("/", async (c) =>
    success(c, { providers: await Promise.all(enabledProviders().map(describe)) }),
  );

  routes.get("/usage-limits", async (c) => {
    const usageLimits = await deps.providerUsageLimitService.getUsageLimits(enabledProviders());
    return success(c, { usageLimits });
  });

  return routes;
}
