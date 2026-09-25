import type {
  NewSessionDefaults,
  ProviderInfo,
  ProviderUsageLimits,
  ScholaraioSkillDetail,
  ScholaraioSkillsResponse,
} from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { pathSegment, requestJson } from "./http";

export const settingsApi = {
  get: (signal?: AbortSignal) =>
    requestJson<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/api/settings", {
      signal,
    }),
  save: (newSessionDefaults: NewSessionDefaults) =>
    requestJson<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ newSessionDefaults }),
    }),
  providers: (signal?: AbortSignal) =>
    requestJson<{ providers: ProviderInfo[] }>("/api/providers", { signal }),
  usageLimits: (signal?: AbortSignal) =>
    requestJson<{ usageLimits: ProviderUsageLimits[] }>("/api/providers/usage-limits", {
      signal,
    }),
  /** Show one of the library's own directories in the desktop file manager. */
  openDirectory: (target: "data" | "papers" | "workspaces") =>
    requestJson<{ opened: boolean }>(`/api/library/directories/${target}/reveal`, {
      method: "POST",
    }),
};

/** Research skills browsed from SCHOLARAIO_SKILLS_DIR. */
export const skillsApi = {
  list: (signal?: AbortSignal) =>
    requestJson<ScholaraioSkillsResponse>("/api/skills/scholaraio", { signal }),
  get: (name: string, signal?: AbortSignal) =>
    requestJson<ScholaraioSkillDetail>(`/api/skills/scholaraio/${pathSegment(name)}`, { signal }),
  refresh: () =>
    requestJson<{ refreshed: boolean; count: number }>("/api/skills/scholaraio/refresh", {
      method: "POST",
    }),
};

/** The Hub's own settings (new-chat defaults). */
export const appSettingsQuery = queryOptions({
  queryKey: ["app-settings"],
  queryFn: ({ signal }) => settingsApi.get(signal),
});

/** Providers as the server describes them (models, capabilities, auth). */
export const providersQuery = queryOptions({
  queryKey: ["providers"],
  queryFn: ({ signal }) => settingsApi.providers(signal),
  staleTime: 60_000,
});

export const skillsQuery = queryOptions({
  queryKey: ["scholaraio-skills"],
  queryFn: ({ signal }) => skillsApi.list(signal),
  // They change only when the skills directory is refreshed, which invalidates them.
  staleTime: Number.POSITIVE_INFINITY,
});

export const skillQuery = (name: string) =>
  queryOptions({
    queryKey: ["scholaraio-skills", name],
    queryFn: ({ signal }) => skillsApi.get(name, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
