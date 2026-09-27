import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncCache } from "../../src/utils/async-cache.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("AsyncCache", () => {
  it("shares one load between concurrent callers and keeps it for the ttl", async () => {
    vi.useFakeTimers();
    const cache = new AsyncCache<string, number>({ ttlMs: 1000 });
    const load = vi.fn(async () => 1);

    await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets a failure unless told to repeat it for a while", async () => {
    vi.useFakeTimers();
    const forgetful = new AsyncCache<string, number>({ ttlMs: 1000 });
    const failing = vi.fn(async (): Promise<number> => {
      throw new Error("broken");
    });
    await expect(forgetful.get("k", failing)).rejects.toThrow("broken");
    await expect(forgetful.get("k", failing)).rejects.toThrow("broken");
    expect(failing).toHaveBeenCalledTimes(2);

    const patient = new AsyncCache<string, number>({ ttlMs: 1000, failureTtlMs: 500 });
    failing.mockClear();
    await expect(patient.get("k", failing)).rejects.toThrow("broken");
    await expect(patient.get("k", failing)).rejects.toThrow("broken");
    expect(failing).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    await expect(patient.get("k", failing)).rejects.toThrow("broken");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("loads again a value it was told not to keep", async () => {
    const cache = new AsyncCache<string, number[]>({
      ttlMs: 1000,
      keep: (value) => value.length > 0,
    });
    const load = vi.fn(async () => [] as number[]);
    await cache.get("k", load);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
