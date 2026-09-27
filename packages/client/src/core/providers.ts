import type { ProviderInfo, ProviderUsageLimits } from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
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
/** 定义 Provider 状态查询及缓存时间。 */
export const providersQuery = queryOptions({
  queryKey: ["providers"],
  queryFn: ({ signal }) => providersApi.list(signal),
  staleTime: 60_000,
});
