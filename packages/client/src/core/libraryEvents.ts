import { useEffect, useState } from "react";
import { libraryUrl } from "./http";
import { queryClient } from "./queryClient";

/** What changed in the library, as published by the library service. */
export interface LibraryEvent {
  type: "imports" | "tasks" | "papers" | "collections";
}

/** Query keys each change invalidates. */
const AFFECTED: Record<LibraryEvent["type"], string[][]> = {
  imports: [["library", "imports"]],
  tasks: [["library", "capabilities"]],
  papers: [
    ["library", "search"],
    ["library", "papers"],
    ["library", "analytics"],
    ["library", "capabilities"],
  ],
  collections: [
    ["library", "collections"],
    // One collection's detail, which also says which papers are in it.
    ["library", "collection"],
    ["library", "search"],
  ],
};

/** A stream update: whether it is carrying changes, and the change itself. */
export type LibraryUpdate = { connected: boolean; event?: LibraryEvent };
type Listener = (update: LibraryUpdate) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

function announce(update: LibraryUpdate): void {
  for (const listener of listeners) listener(update);
}

/**
 * Listen for library changes over one shared stream.
 *
 * The connection is opened for the first listener and closed after the last
 * one leaves, so a closed tab stops the work it started.
 */
export function subscribeLibraryEvents(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource(libraryUrl("/events"));
    source.onopen = () => announce({ connected: true });
    source.onmessage = (message) => {
      let event: LibraryEvent;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        console.error("[library] unreadable event", error, message.data);
        return;
      }
      // Once per change, however many components hold the stream open.
      for (const queryKey of AFFECTED[event.type] ?? [["library"]]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      announce({ connected: true, event });
    };
    // EventSource reconnects on its own; until it does, callers must ask.
    source.onerror = () => announce({ connected: false });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

/**
 * Hold the change stream open while mounted, which keeps the library's queries
 * current. Returns whether it is carrying changes; while it is not, callers
 * that need fresh data have to poll for it.
 */
export function useLibraryStream(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => subscribeLibraryEvents(({ connected: live }) => setConnected(live)), []);
  return connected;
}
