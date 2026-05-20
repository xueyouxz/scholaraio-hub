import { useEffect } from "react";
import { api } from "../api/client";

const ENGAGEMENT_DELAY_MS = 2000;

export function useEngagementTracking(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      api.markSessionSeen(sessionId).catch(() => {});
    }, ENGAGEMENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sessionId]);
}
