import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ProviderGroupFilter } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";
import { type GlobalSessionItem, api } from "../api/client";

const GROUP_SESSION_LIMIT = 5;

export interface GroupSessionState {
  sessions: GlobalSessionItem[];
  loading: boolean;
  loaded: boolean;
}

const EMPTY: GroupSessionState = { sessions: [], loading: false, loaded: false };

function groupQueryKey(projectId: string, provider?: ProviderGroupFilter | null) {
  return [...queryKeys.projectSessions(projectId, provider), "group", GROUP_SESSION_LIMIT] as const;
}

export function useGroupSessions() {
  const queryClient = useQueryClient();
  const [, setVersion] = useState(0);

  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (Array.isArray(key) && key.includes("group")) {
        setVersion((v) => v + 1);
      }
    });
  }, [queryClient]);

  const loadGroup = useCallback(
    (projectId: string, provider?: ProviderGroupFilter | null) => {
      const key = groupQueryKey(projectId, provider);
      const state = queryClient.getQueryState<{ sessions: GlobalSessionItem[] }>(key);
      if (state?.status === "success" || state?.fetchStatus === "fetching") return;

      void queryClient
        .fetchQuery({
          queryKey: key,
          queryFn: ({ signal }) =>
            api.getGlobalSessions(
              {
                project: projectId,
                limit: GROUP_SESSION_LIMIT,
                provider: provider ?? undefined,
              },
              { signal },
            ),
          staleTime: 30_000,
        })
        .catch((err) => {
          console.error("[Sidebar] failed to load project sessions group", err);
        });
    },
    [queryClient],
  );

  const getGroup = useCallback(
    (projectId: string, provider?: ProviderGroupFilter | null): GroupSessionState => {
      const key = groupQueryKey(projectId, provider);
      const state = queryClient.getQueryState<{ sessions: GlobalSessionItem[] }>(key);
      if (!state) return EMPTY;
      return {
        sessions: state.data?.sessions ?? [],
        loading: state.fetchStatus === "fetching",
        loaded: state.status === "success",
      };
    },
    [queryClient],
  );

  return { loadGroup, getGroup };
}
