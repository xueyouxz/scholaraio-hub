import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ProviderGroupFilter } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";
import { type GlobalSessionItem, api } from "../api/client";
import { activityBus } from "../lib/activityBus";

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

  // When the server emits session-created, immediately prepend the new session
  // into every loaded group cache for that project via setQueryData.
  // This mirrors the template's approach (direct setSessions) and avoids the
  // removeQueries → re-fetch path, which races against JSONL write timing:
  // the HTTP response from startSession can return before the session file is
  // written, making an immediate refetch return stale data.
  useEffect(() => {
    const unsubscribe = activityBus.on("session-created", (event) => {
      const projectId = event.session.projectId;
      const cache = queryClient.getQueryCache();

      // Find all successfully loaded group queries for this project.
      // The key shape is ["projects", projectId, "sessions", provider, "group", limit].
      const queries = cache.findAll({ queryKey: ["projects", projectId, "sessions"] });

      for (const query of queries) {
        const key = query.queryKey as unknown[];
        if (!key.includes("group")) continue;
        if (query.state.status !== "success") continue;

        const data = query.state.data as { sessions: GlobalSessionItem[] } | undefined;
        if (!data?.sessions) continue;

        // Deduplicate — the event may arrive after a refetch already included it.
        if (data.sessions.some((s) => s.id === event.session.id)) continue;

        // Derive projectName from existing sessions in this group as a cheap
        // fallback (it is not included in AppSessionSummary).
        const projectName = data.sessions[0]?.projectName ?? projectId;

        const newSession: GlobalSessionItem = {
          id: event.session.id,
          title: event.session.title ?? null,
          customTitle: event.session.customTitle,
          createdAt: event.session.createdAt,
          updatedAt: event.session.updatedAt,
          messageCount: event.session.messageCount ?? 0,
          provider: event.session.provider,
          projectId: event.session.projectId,
          projectName,
          ownership: event.session.ownership,
          pendingInputType: event.session.pendingInputType,
          activity: event.session.activity,
          hasUnread: event.session.hasUnread ?? false,
          isArchived: event.session.isArchived ?? false,
          isStarred: event.session.isStarred ?? false,
          model: event.session.model,
          executor: event.session.executor,
        };

        // setQueryData is synchronous: fires cache event → setVersion → re-render.
        queryClient.setQueryData(query.queryKey, {
          sessions: [newSession, ...data.sessions],
        });
      }
    });
    return unsubscribe;
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
