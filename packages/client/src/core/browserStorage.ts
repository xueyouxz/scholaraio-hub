/**
 * Browser storage for per-viewer conveniences (panel widths, drafts, last
 * choices). Storage can be missing or refuse writes (private windows, quota,
 * blocked site data); then reads give the fallback and writes are dropped with
 * a warning, since none of this is state the app depends on.
 */
type StorageKind = "local" | "session";

function storage(kind: StorageKind): Storage {
  return kind === "local" ? localStorage : sessionStorage;
}

export function readStored(key: string, kind: StorageKind = "local"): string | null {
  try {
    return storage(kind).getItem(key);
  } catch (error) {
    console.warn(`Could not read ${key} from browser storage`, error);
    return null;
  }
}

/** Store `value` under `key`; null removes it. */
export function writeStored(key: string, value: string | null, kind: StorageKind = "local"): void {
  try {
    if (value === null) storage(kind).removeItem(key);
    else storage(kind).setItem(key, value);
  } catch (error) {
    console.warn(`Could not write ${key} to browser storage`, error);
  }
}

export function readStoredJson<T>(key: string, fallback: T): T {
  const stored = readStored(key);
  if (!stored) return fallback;
  try {
    return JSON.parse(stored) as T;
  } catch (error) {
    console.warn(`Ignoring unreadable ${key} in browser storage`, error);
    return fallback;
  }
}

export function writeStoredJson(key: string, value: unknown): void {
  writeStored(key, JSON.stringify(value));
}

/** A stored number, or undefined when none is stored or it is not a number. */
export function readStoredNumber(key: string): number | undefined {
  const stored = readStored(key);
  const value = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(value) ? value : undefined;
}
