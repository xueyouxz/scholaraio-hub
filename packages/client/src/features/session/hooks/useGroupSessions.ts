import { useCallback, useRef, useState } from "react";
import type { ProviderGroupFilter } from "../../../core/api";
import { type GlobalSessionItem, api } from "../api/client";

const GROUP_SESSION_LIMIT = 5;

export interface GroupSessionState {
  sessions: GlobalSessionItem[];
  loading: boolean;
  loaded: boolean;
}

function getGroupKey(projectId: string, provider?: ProviderGroupFilter | null): string {
  return `${provider ?? "all"}:${projectId}`;
}

export function useGroupSessions() {
  const [groups, setGroups] = useState<Map<string, GroupSessionState>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadGroup = useCallback(
    async (projectId: string, provider?: ProviderGroupFilter | null) => {
      const groupKey = getGroupKey(projectId, provider);
      if (inFlightRef.current.has(groupKey)) return;

      const existing = groups.get(groupKey);
      if (existing?.loaded) return;

      inFlightRef.current.add(groupKey);
      setGroups((prev) => {
        const next = new Map(prev);
        next.set(groupKey, {
          sessions: prev.get(groupKey)?.sessions ?? [],
          loading: true,
          loaded: false,
        });
        return next;
      });

      try {
        const data = await api.getGlobalSessions({
          project: projectId,
          limit: GROUP_SESSION_LIMIT,
          provider: provider ?? undefined,
        });
        setGroups((prev) => {
          const next = new Map(prev);
          next.set(groupKey, { sessions: data.sessions, loading: false, loaded: true });
          return next;
        });
      } catch {
        setGroups((prev) => {
          const next = new Map(prev);
          next.set(groupKey, { sessions: [], loading: false, loaded: true });
          return next;
        });
      } finally {
        inFlightRef.current.delete(groupKey);
      }
    },
    [groups],
  );

  const getGroup = useCallback(
    (projectId: string, provider?: ProviderGroupFilter | null): GroupSessionState =>
      groups.get(getGroupKey(projectId, provider)) ?? {
        sessions: [],
        loading: false,
        loaded: false,
      },
    [groups],
  );

  return { loadGroup, getGroup };
}
