import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../src/providers/MessageQueue.js";
import type { AgentEvent } from "../src/providers/events.js";
import type { StartSessionOptions } from "../src/providers/types.js";
import { type SessionMessageRequest, Supervisor } from "../src/supervisor/Supervisor.js";
import type { ProcessEvent } from "../src/supervisor/types.js";
import { createScriptedProvider, providerFromSessionFactory } from "./helpers/scriptedProvider.js";

const request = (overrides: Partial<SessionMessageRequest> = {}): SessionMessageRequest => ({
  sessionId: "app-1",
  projectPath: "/tmp/test",
  message: { text: "hi" },
  ...overrides,
});

describe("Supervisor", () => {
  let supervisor: Supervisor;
  let startCalls: StartSessionOptions[];
  let events: Array<{ sessionId: string; event: ProcessEvent }>;

  beforeEach(() => {
    startCalls = [];
    events = [];
    supervisor = new Supervisor({
      provider: createScriptedProvider({ startCalls, holdOpen: true }),
      idleTimeoutMs: 60_000,
      onEvent: (sessionId, event) => events.push({ sessionId, event }),
    });
  });

  afterEach(() => {
    supervisor.close();
  });

  it("starts a process for our session, which learns the provider's id", async () => {
    const process = await supervisor.send(request());
    expect(process.sessionId).toBe("app-1");
    expect(supervisor.get("app-1")).toBe(process);
    await vi.waitFor(() => expect(process.nativeSessionId).toBe("scripted-1"));
    expect(events[0]).toEqual({
      sessionId: "app-1",
      event: { type: "agent", event: { type: "session.started", sessionId: "scripted-1" } },
    });
  });

  it("passes the requested settings to the provider", async () => {
    await supervisor.send(
      request({
        permissionMode: "plan",
        settings: { model: "opus", thinking: { type: "adaptive" }, effort: "high" },
      }),
    );
    expect(startCalls[0]).toMatchObject({
      cwd: "/tmp/test",
      initialMessage: { text: "hi" },
      permissionMode: "plan",
      model: "opus",
      thinking: { type: "adaptive" },
      effort: "high",
    });
  });

  it("resumes the native conversation in a new process", async () => {
    await supervisor.send(request({ nativeSessionId: "sess-123" }));
    expect(startCalls[0]?.resumeSessionId).toBe("sess-123");
  });

  it("sends to the session's live process while it still matches", async () => {
    const first = await supervisor.send(request({ nativeSessionId: "sess-123" }));
    const second = await supervisor.send(
      request({ nativeSessionId: "sess-123", message: { text: "second" } }),
    );
    expect(second).toBe(first);
    expect(startCalls).toHaveLength(1);
  });

  it("keeps separate processes for separate sessions", async () => {
    const first = await supervisor.send(request());
    const second = await supervisor.send(request({ sessionId: "app-2" }));
    expect(second.id).not.toBe(first.id);
  });

  it.each([
    ["the model", { settings: { model: "sonnet" } }],
    ["the effort", { settings: { effort: "high" } }],
    ["the native conversation (a rewind)", { nativeSessionId: "fork-1" }],
  ])(
    "replaces the live process when %s changes, without reporting its ending",
    async (_, change) => {
      const first = await supervisor.send(request({ nativeSessionId: "sess-123" }));
      const second = await supervisor.send(
        request({ nativeSessionId: "sess-123", ...change, message: { text: "again" } }),
      );
      expect(second.id).not.toBe(first.id);
      expect(first.isTerminated).toBe(true);
      expect(startCalls).toHaveLength(2);
      expect(events.some(({ event }) => event.type === "terminated")).toBe(false);
    },
  );

  it("starts a new process once the old one died, reporting the death", async () => {
    let started = 0;
    const dying = new Supervisor({
      provider: providerFromSessionFactory(async (options) => {
        started += 1;
        async function* stream(): AsyncIterableIterator<AgentEvent> {
          yield { type: "session.started", sessionId: options.resumeSessionId ?? "dying-1" };
          throw new Error("process exited");
        }
        return { events: stream(), queue: new MessageQueue(), abort: () => {} };
      }),
      onEvent: (sessionId, event) => events.push({ sessionId, event }),
    });
    const first = await dying.send(request({ nativeSessionId: "dying-1" }));
    await vi.waitFor(() => expect(first.isTerminated).toBe(true));
    expect(dying.get("app-1")).toBeUndefined();
    expect(events.at(-1)?.event).toMatchObject({
      type: "terminated",
      reason: "provider stream failed",
    });

    const second = await dying.send(request({ nativeSessionId: "dying-1" }));
    expect(second.id).not.toBe(first.id);
    expect(started).toBe(2);
    dying.close();
  });

  it("release stops the process silently", async () => {
    const process = await supervisor.send(request());
    supervisor.release("app-1", "Session deleted");
    expect(process.terminationReason).toBe("Session deleted");
    expect(supervisor.get("app-1")).toBeUndefined();
    expect(events.some(({ event }) => event.type === "terminated")).toBe(false);
  });

  it("names the default provider for no name, and refuses an unknown one", () => {
    expect(supervisor.providerFor(undefined).name).toBe("claude");
    expect(() => supervisor.providerFor("nope" as never)).toThrow("Unknown provider: nope");
  });

  it("releases live idle workers after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      let started = 0;
      const idle = new Supervisor({
        provider: providerFromSessionFactory(async () => {
          started += 1;
          async function* stream(): AsyncIterableIterator<AgentEvent> {
            yield { type: "session.started", sessionId: "idle-native" };
            yield { type: "turn.completed" };
            while (!aborted) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return {
            events: stream(),
            queue: new MessageQueue(),
            abort: () => {
              aborted = true;
            },
            isProcessAlive: () => !aborted,
          };
        }),
        idleTimeoutMs: 100,
        onEvent: () => {},
      });

      const process = await idle.send(request({ message: { text: "Keep this session alive" } }));
      await vi.advanceTimersByTimeAsync(0);
      expect(process.state.type).toBe("idle");

      await vi.advanceTimersByTimeAsync(150);

      expect(aborted).toBe(true);
      expect(process.nativeSessionId).toBe("idle-native");
      // The session outlives its worker: the next message starts a new one.
      aborted = false;
      const next = await idle.send(
        request({ nativeSessionId: "idle-native", message: { text: "again" } }),
      );
      expect(next.id).not.toBe(process.id);
      expect(started).toBe(2);
      idle.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
