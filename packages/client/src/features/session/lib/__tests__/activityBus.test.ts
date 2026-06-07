import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityBus } from "../activityBus";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly init?: EventSourceInit;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  private listeners = new Map<string, Set<EventListener>>();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

describe("ActivityBus", () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not leak document visibility listeners across reconnects", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const bus = new ActivityBus();

    bus.connect();
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.fail();
    vi.advanceTimersByTime(1000);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(addSpy.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);

    bus.disconnect();

    expect(removeSpy.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
  });

  it("removes source event listeners when disconnected", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const bus = new ActivityBus();

    bus.connect();
    const source = FakeEventSource.instances[0];
    expect(source?.listenerCount("connected")).toBe(1);
    expect(source?.listenerCount("session-updated")).toBe(1);

    bus.disconnect();

    expect(source?.listenerCount("connected")).toBe(0);
    expect(source?.listenerCount("session-updated")).toBe(0);
    expect(source?.close).toHaveBeenCalled();
  });
});
