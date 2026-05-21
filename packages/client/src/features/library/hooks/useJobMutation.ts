import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { scholar } from "../../../core/api";
import { queryKeys } from "../../../core/queryKeys";

const SCHOLAR_API_BASE = "/api/scholar/api/v1";

export function useJobMutation(kind: "topics" | "project") {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${SCHOLAR_API_BASE}/jobs/stream`);

    es.onmessage = (e) => {
      let event: { kind: string; status: string };
      try {
        event = JSON.parse(e.data) as { kind: string; status: string };
      } catch {
        return;
      }
      if (event.kind !== kind) return;
      if (event.status === "running") {
        setIsPending(true);
      } else if (
        event.status === "succeeded" ||
        event.status === "failed" ||
        event.status === "cancelled"
      ) {
        setIsPending(false);
        const key =
          kind === "project" ? queryKeys.scholar.projection() : queryKeys.scholar.topics();
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    es.onerror = () => setIsPending(false);

    return () => es.close();
  }, [kind, queryClient]);

  const submit = useCallback(() => {
    if (isPending) return;
    setIsPending(true);
    scholar.submitJob({ kind }).catch(() => setIsPending(false));
  }, [kind, isPending]);

  return { submit, isPending };
}
