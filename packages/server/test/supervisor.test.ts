import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../src/providers/MessageQueue.js";
import { ProviderRegistry } from "../src/providers/ProviderRegistry.js";
import type { AgentEvent } from "../src/providers/events.js";
import type { StartSessionOptions } from "../src/providers/types.js";
import type { ProcessEvent } from "../src/supervisor/AgentProcess.js";
import { type SessionMessageRequest, Supervisor } from "../src/supervisor/Supervisor.js";
import { createScriptedProvider, providerFromSessionFactory } from "./helpers/scriptedProvider.js";

/** 只启用一个由会话工厂构造的 Provider。 */
const registryFromFactory = (factory: Parameters<typeof providerFromSessionFactory>[0]) =>
  new ProviderRegistry([providerFromSessionFactory(factory)]);

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
      providers: new ProviderRegistry([createScriptedProvider({ startCalls, holdOpen: true })]),
      idleTimeoutMs: 60_000,
    });
    supervisor.subscribe((sessionId, event) => events.push({ sessionId, event }));
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

  it("launches one process for sends that arrive together", async () => {
    const [first, second] = await Promise.all([
      supervisor.send(request({ nativeSessionId: "sess-123" })),
      supervisor.send(request({ nativeSessionId: "sess-123", message: { text: "second" } })),
    ]);
    expect(second).toBe(first);
    expect(startCalls).toHaveLength(1);
  });

  it("releases only the process the caller expects", async () => {
    const first = await supervisor.send(request({ nativeSessionId: "sess-1" }));
    const second = await supervisor.send(request({ nativeSessionId: "sess-2" }));
    // The first was replaced when the conversation changed.
    expect(first.isTerminated).toBe(true);
    supervisor.release("app-1", "late stop of the first", first);
    expect(supervisor.get("app-1")).toBe(second);
    expect(second.isTerminated).toBe(false);
  });

  it("waits for the CLIs to exit on close, and starts none afterwards", async () => {
    let exit = () => {};
    const exited = new Promise<void>((resolve) => {
      exit = resolve;
    });
    const closing = new Supervisor({
      providers: registryFromFactory(async () => ({
        events: (async function* (): AsyncIterableIterator<AgentEvent> {
          yield { type: "session.started", sessionId: "native" };
          await exited;
        })(),
        queue: new MessageQueue(),
        abort: () => exited,
      })),
    });
    await closing.send(request());
    let closed = false;
    const close = closing.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    exit();
    await close;
    await expect(closing.send(request())).rejects.toThrow("shutting down");
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
      providers: registryFromFactory(async (options) => {
        started += 1;
        async function* stream(): AsyncIterableIterator<AgentEvent> {
          yield { type: "session.started", sessionId: options.resumeSessionId ?? "dying-1" };
          throw new Error("process exited");
        }
        return { events: stream(), queue: new MessageQueue(), abort: () => {} };
      }),
    });
    dying.subscribe((sessionId, event) => events.push({ sessionId, event }));
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

  it("stops a process whose approval nobody answers, saying why", async () => {
    vi.useFakeTimers();
    try {
      const waiting = new Supervisor({
        providers: new ProviderRegistry([createScriptedProvider({ startCalls, holdOpen: true })]),
        unansweredInputTimeoutMs: 1000,
      });
      waiting.subscribe((sessionId, event) => events.push({ sessionId, event }));
      const process = await waiting.send(request());
      const answer = process.handleToolApproval(
        "Bash",
        { command: "ls" },
        {
          signal: new AbortController().signal,
        },
      );
      expect(process.state.type).toBe("waiting-input");
      await vi.advanceTimersByTimeAsync(61_000);
      expect(process.isTerminated).toBe(true);
      await expect(answer).resolves.toMatchObject({ behavior: "deny" });
      const ended = events.find(({ event }) => event.type === "terminated")?.event;
      expect(ended).toMatchObject({ type: "terminated" });
      expect(ended?.type === "terminated" && ended.error?.message).toContain("Approval timed out");
      waiting.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases live idle workers after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      let started = 0;
      const idle = new Supervisor({
        providers: registryFromFactory(async () => {
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
