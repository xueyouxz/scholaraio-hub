/**
 * Notices the providers' CLIs writing session files — the Hub's own sessions
 * and those run from a terminal alike — so lists refresh without polling, and
 * a session someone else is writing to right now can say so.
 */

import { type FSWatcher, watch } from "node:fs";
import type { ProviderName } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { isDirectory } from "./directories.js";

const log = () => loggerFor("history-watcher");

/** How long writes are collected before listeners hear of them. */
const DEBOUNCE_MS = 250;
/** How long a session another program wrote to counts as in use by it. */
const EXTERNAL_MS = 30_000;

/** Sessions whose files changed, by provider; `all` when a file could not be named. */
export interface HistoryChange {
  sessions: Array<{ provider: ProviderName; id: string }>;
  all: boolean;
}

export interface HistoryWatcherOptions {
  providers: ProviderRegistry;
  /** Whether this Hub runs the session now; its own writes are not another program's. */
  owns: (provider: ProviderName, id: string) => boolean;
}

export class HistoryWatcher {
  private readonly watchers: FSWatcher[] = [];
  private readonly listeners = new Set<(change: HistoryChange) => void>();
  private pending: HistoryChange = { sessions: [], all: false };
  private timer?: ReturnType<typeof setTimeout>;
  /** When each session another program wrote to stops counting as in use. */
  private readonly external = new Map<string, number>();
  /** Fires when the earliest of those ends, so lists stop showing it. */
  private expiry?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: HistoryWatcherOptions) {}

  /** Watch every provider's history directory that exists; one that does not is skipped. */
  async start(): Promise<void> {
    for (const provider of this.options.providers.list()) {
      const files = provider.historyFiles?.();
      if (!files || !(await isDirectory(files.directory))) continue;
      try {
        const watcher = watch(files.directory, { recursive: true }, (_, file) => {
          const id = file ? files.sessionOf(file.toString()) : undefined;
          this.record(provider.name, id, !file);
        });
        watcher.on("error", (error) => {
          log().warn({ err: error, provider: provider.name }, "History watcher stopped");
          watcher.close();
        });
        this.watchers.push(watcher);
      } catch (error) {
        log().warn(
          { err: error, provider: provider.name, directory: files.directory },
          "Cannot watch the provider's history",
        );
      }
    }
  }

  /** Hear of changes until the returned unsubscribe, or `close`. */
  subscribe(listener: (change: HistoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether another program wrote to the session within the last half minute. */
  isExternal(provider: ProviderName, id: string): boolean {
    const until = this.external.get(`${provider}:${id}`);
    return until !== undefined && until > Date.now();
  }

  close(): void {
    clearTimeout(this.timer);
    clearTimeout(this.expiry);
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
    this.listeners.clear();
    this.external.clear();
  }

  private record(provider: ProviderName, id: string | undefined, unnamed: boolean): void {
    if (id) {
      this.pending.sessions.push({ provider, id });
      if (!this.options.owns(provider, id))
        this.external.set(`${provider}:${id}`, Date.now() + EXTERNAL_MS);
    } else if (unnamed) this.pending.all = true;
    else return;
    this.timer ??= setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private flush(): void {
    this.timer = undefined;
    const change = this.pending;
    this.pending = { sessions: [], all: false };
    this.scheduleExpiry();
    this.announce(change);
  }

  /** Sessions another program stopped writing to are no longer in use: announce them. */
  private expire(): void {
    this.expiry = undefined;
    const now = Date.now();
    const sessions: HistoryChange["sessions"] = [];
    for (const [key, until] of this.external) {
      if (until > now) continue;
      this.external.delete(key);
      const [provider, id] = key.split(/:(.*)/s) as [ProviderName, string];
      sessions.push({ provider, id });
    }
    this.scheduleExpiry();
    if (sessions.length) this.announce({ sessions, all: false });
  }

  private scheduleExpiry(): void {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.external.size === 0) return;
    const next = Math.min(...this.external.values());
    this.expiry = setTimeout(() => this.expire(), Math.max(0, next - Date.now()) + 10);
  }

  private announce(change: HistoryChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        log().error({ err: error }, "History listener failed");
      }
    }
  }
}
