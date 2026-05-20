import { useCallback, useRef, useState } from "react";
import { type GlobalSessionItem, api } from "../api/client";

const GROUP_SESSION_LIMIT = 5;

export interface GroupSessionState {
  sessions: GlobalSessionItem[];
  loading: boolean;
  loaded: boolean;
}

export function useGroupSessions() {
  const [groups, setGroups] = useState<Map<string, GroupSessionState>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadGroup = useCallback(
    async (projectId: string) => {
      if (inFlightRef.current.has(projectId)) return;

      const existing = groups.get(projectId);
      if (existing?.loaded) return;

      inFlightRef.current.add(projectId);
      setGroups((prev) => {
        const next = new Map(prev);
        next.set(projectId, {
          sessions: prev.get(projectId)?.sessions ?? [],
          loading: true,
          loaded: false,
        });
        return next;
      });

      try {
        const data = await api.getGlobalSessions({
          project: projectId,
          limit: GROUP_SESSION_LIMIT,
        });
        setGroups((prev) => {
          const next = new Map(prev);
          next.set(projectId, { sessions: data.sessions, loading: false, loaded: true });
          return next;
        });
      } catch {
        setGroups((prev) => {
          const next = new Map(prev);
          next.set(projectId, { sessions: [], loading: false, loaded: true });
          return next;
        });
      } finally {
        inFlightRef.current.delete(projectId);
      }
    },
    [groups],
  );

  const getGroup = useCallback(
    (projectId: string): GroupSessionState =>
      groups.get(projectId) ?? { sessions: [], loading: false, loaded: false },
    [groups],
  );

  return { loadGroup, getGroup };
}
