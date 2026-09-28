/**
 * Answers that are slow to get and change rarely — a CLI's login, its models,
 * its commands. Each key is loaded once at a time (concurrent callers share the
 * load) and kept for `ttlMs`. A failed load is forgotten, so the next caller
 * tries again, unless `failureTtlMs` keeps repeating the failure until then:
 * that keeps a broken CLI from being asked on every call.
 */
export interface AsyncCacheOptions<V> {
  ttlMs: number;
  failureTtlMs?: number;
  /** Whether a loaded value is worth keeping; one that is not is loaded again next time. */
  keep?: (value: V) => boolean;
}

interface Entry<V> {
  value: Promise<V>;
  expiresAt: number;
}

export class AsyncCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();

  constructor(private readonly options: AsyncCacheOptions<V>) {}

  get(key: K, load: () => Promise<V>): Promise<V> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    // A load in flight never expires; it is dated once it settles.
    const entry: Entry<V> = { value: load(), expiresAt: Number.POSITIVE_INFINITY };
    this.entries.set(key, entry);
    entry.value.then(
      (value) => {
        if (this.entries.get(key) !== entry) return;
        if (this.options.keep && !this.options.keep(value)) this.entries.delete(key);
        else entry.expiresAt = Date.now() + this.options.ttlMs;
      },
      () => {
        if (this.entries.get(key) !== entry) return;
        if (this.options.failureTtlMs) entry.expiresAt = Date.now() + this.options.failureTtlMs;
        else this.entries.delete(key);
      },
    );
    return entry.value;
  }

  /** Forget `key`: the next caller loads it anew, even while a load is in flight. */
  delete(key: K): void {
    this.entries.delete(key);
  }
}
