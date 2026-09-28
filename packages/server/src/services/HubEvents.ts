import type { HubEvent } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";

/**
 * What changed, for pages that keep lists open (`GET /api/events`). Publishers
 * say what kind of thing changed; each page asks again for what it shows.
 */
export class HubEvents {
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private readonly closing = new AbortController();

  /** Aborts when the server closes, so open streams end. */
  get closed(): AbortSignal {
    return this.closing.signal;
  }

  publish(event: HubEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        loggerFor("events").error({ err: error, event: event.type }, "Event listener failed");
      }
    }
  }

  /** Hear every event until the returned unsubscribe, or `close`. */
  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closing.abort();
    this.listeners.clear();
  }
}
