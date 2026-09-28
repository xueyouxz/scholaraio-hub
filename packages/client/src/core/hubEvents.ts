import type { HubEvent } from "@scholaraio-hub/shared";
import { useEffect } from "react";
import { PROJECTS_KEY } from "./projects";
import { queryClient } from "./queryClient";

/** Query keys each change invalidates. */
const AFFECTED: Record<HubEvent["type"], ReadonlyArray<readonly string[]>> = {
  sessions: [PROJECTS_KEY],
};

let source: EventSource | null = null;
let holders = 0;

/**
 * Keep the project and session lists current over one shared stream of the
 * server's changes (`/api/events`). The stream is opened for the first holder
 * and closed after the last one leaves, so a closed tab stops the work it started.
 */
export function holdHubEvents(): () => void {
  holders += 1;
  if (!source) {
    source = new EventSource("/api/events");
    source.onmessage = (message) => {
      let event: HubEvent;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        console.error("[hub] unreadable event", error, message.data);
        return;
      }
      for (const queryKey of AFFECTED[event.type] ?? [])
        void queryClient.invalidateQueries({ queryKey });
    };
    // EventSource reconnects on its own; lists refetch on focus meanwhile.
  }
  return () => {
    holders -= 1;
    if (holders === 0) {
      source?.close();
      source = null;
    }
  };
}

/** Hold the server's change stream open while mounted. */
export function useHubEvents(): void {
  useEffect(() => holdHubEvents(), []);
}
