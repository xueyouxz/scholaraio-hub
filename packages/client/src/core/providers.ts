import type { ProviderInfo, ProviderUsageLimits } from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { readStoredJson, writeStoredJson } from "./browserStorage";
import { hubHttp } from "./http";

/** 查询 Provider 状态、模型和用量限制。 */
export const providersApi = {
  list: (signal?: AbortSignal) =>
    hubHttp.json<{ providers: ProviderInfo[] }>("/providers", { signal }),
  usageLimits: (signal?: AbortSignal) =>
    hubHttp.json<{ usageLimits: ProviderUsageLimits[] }>("/providers/usage-limits", {
      signal,
    }),
};
type ProviderList = { providers: ProviderInfo[] };

/**
 * 上次拿到的 Provider 列表（模型、权限、思考选项）。页面加载时先用它，
 * composer 和设置页不必等接口返回就能显示上次的选择；只是本浏览器的便利，
 * 没有它时照常等待接口。
 */
const LAST_PROVIDERS_KEY = "hub-providers:last";

/** 旧版本写入或被改坏的缓存不用：只认界面实际读取的结构。 */
function isProviderList(value: unknown): value is ProviderList {
  const providers = (value as Partial<ProviderList> | null)?.providers;
  return (
    Array.isArray(providers) &&
    providers.every(
      (provider) =>
        typeof provider?.name === "string" &&
        Array.isArray(provider.capabilities?.permissionModes) &&
        Array.isArray(provider.capabilities?.thinkingModes),
    )
  );
}

function lastProviders(): ProviderList | undefined {
  const stored = readStoredJson<unknown>(LAST_PROVIDERS_KEY, undefined);
  return isProviderList(stored) ? stored : undefined;
}

/** 定义 Provider 状态查询及缓存时间；以上次的列表起步，并立即重新请求。 */
export const providersQuery = queryOptions({
  queryKey: ["providers"],
  queryFn: async ({ signal }) => {
    const list = await providersApi.list(signal);
    writeStoredJson(LAST_PROVIDERS_KEY, list);
    return list;
  },
  staleTime: 60_000,
  initialData: lastProviders,
  // 缓存从一开始就算过期，挂载时照常向服务端确认。
  initialDataUpdatedAt: 0,
});
