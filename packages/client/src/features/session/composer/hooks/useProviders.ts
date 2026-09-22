import type { ProviderInfo, ProviderName } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "../../../../core/library";

/** Providers as the server describes them (models, capabilities, auth). */
export function useProviders() {
  const query = useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) => settingsApi.providers(signal),
    staleTime: 60_000,
  });
  const providers: ProviderInfo[] = query.data?.providers ?? [];
  const find = (name: ProviderName) => providers.find((provider) => provider.name === name);
  return { ...query, providers, find };
}
