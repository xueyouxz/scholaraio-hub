import { afterEach, describe, expect, it, vi } from "vitest";
import { type LibraryUpdate, subscribeLibraryEvents } from "../libraryEvents";
import { queryClient } from "../queryClient";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

function useFakeStream() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return () => FakeEventSource.instances;
}

describe("library change stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens one connection for every listener and closes it with the last", () => {
    const instances = useFakeStream();
    const first = subscribeLibraryEvents(() => {});
    const second = subscribeLibraryEvents(() => {});
    expect(instances()).toHaveLength(1);

    first();
    expect(instances()[0]?.closed).toBe(false);
    second();
    expect(instances()[0]?.closed).toBe(true);
  });

  it("delivers a change to every listener", () => {
    const instances = useFakeStream();
    const seen: LibraryUpdate[] = [];
    const stop = subscribeLibraryEvents((update) => seen.push(update));
    instances()[0]?.onmessage?.({ data: JSON.stringify({ type: "imports" }) });
    stop();
    expect(seen).toEqual([{ connected: true, event: { type: "imports" } }]);
  });

  it("invalidates a change once, however many listeners hold the stream", () => {
    const instances = useFakeStream();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const stops = [subscribeLibraryEvents(() => {}), subscribeLibraryEvents(() => {})];
    instances()[0]?.onmessage?.({ data: JSON.stringify({ type: "imports" }) });
    for (const stop of stops) stop();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["library", "imports"] });
    invalidate.mockRestore();
  });

  it("reports a dropped stream so callers can ask instead", () => {
    const instances = useFakeStream();
    const seen: LibraryUpdate[] = [];
    const stop = subscribeLibraryEvents((update) => seen.push(update));
    instances()[0]?.onerror?.();
    stop();
    expect(seen).toEqual([{ connected: false }]);
  });

  it("keeps listening when one message is unreadable", () => {
    const instances = useFakeStream();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: LibraryUpdate[] = [];
    const stop = subscribeLibraryEvents((update) => seen.push(update));
    instances()[0]?.onmessage?.({ data: "not json" });
    instances()[0]?.onmessage?.({ data: JSON.stringify({ type: "tasks" }) });
    stop();
    expect(seen).toEqual([{ connected: true, event: { type: "tasks" } }]);
  });
});
