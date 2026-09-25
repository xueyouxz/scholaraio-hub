import type { ProviderInfo, ProviderName } from "@scholaraio-hub/shared";
import { useQuery } from "@tanstack/react-query";
import { providersQuery } from "../../../../core/settings";

/** The providers, and one looked up by name. */
export function useProviders() {
  const query = useQuery(providersQuery);
  const providers: ProviderInfo[] = query.data?.providers ?? [];
  const find = (name: ProviderName) => providers.find((provider) => provider.name === name);
  return { ...query, providers, find };
}
