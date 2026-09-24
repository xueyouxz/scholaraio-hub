import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/agent/events.js";
import { MessageQueue } from "../src/sdk/messageQueue.js";
import type { StartSessionOptions } from "../src/sdk/providers/types.js";
import { Supervisor } from "../src/supervisor/Supervisor.js";
import { createScriptedProvider, providerFromSessionFactory } from "./helpers/scriptedProvider.js";

describe("Supervisor", () => {
  let supervisor: Supervisor;
  let startCalls: StartSessionOptions[];

  beforeEach(() => {
    startCalls = [];
    supervisor = new Supervisor({
      provider: createScriptedProvider({ startCalls, holdOpen: true }),
      idleTimeoutMs: 60_000,
    });
  });

  afterEach(async () => {
    await supervisor.close();
  });

  describe("startSession", () => {
    it("starts a process that takes the provider's session id", async () => {
      const process = await supervisor.startSession({
        projectPath: "/tmp/test",
        message: { text: "hi" },
      });

      expect(process.projectPath).toBe("/tmp/test");
      expect(process.sessionId).toBe("scripted-1");
    });

    it("passes the requested settings to the provider", async () => {
      await supervisor.startSession({
        projectPath: "/tmp/test",
        message: { text: "hi" },
        permissionMode: "plan",
        modelSettings: {
          model: "opus",
          thinking: { type: "adaptive" },
          effort: "high",
          globalInstructions: "Prefer concise answers.",
        },
      });

      expect(startCalls[0]).toMatchObject({
        cwd: "/tmp/test",
        initialMessage: { text: "hi" },
        permissionMode: "plan",
        model: "opus",
        thinking: { type: "adaptive" },
        effort: "high",
        globalInstructions: "Prefer concise answers.",
      });
    });

    it("tells its owner about every process it creates", async () => {
      const created: string[] = [];
      const owned = new Supervisor({
        provider: createScriptedProvider({ holdOpen: true }),
        onProcessCreated: (process) => created.push(process.ownerId ?? ""),
      });
      await owned.startSession({
        projectPath: "/tmp/test",
        ownerId: "app-1",
        message: { text: "hi" },
      });
      expect(created).toEqual(["app-1"]);
      await owned.close();
    });
  });

  describe("resumeSession", () => {
    it("resumes the named session in a new process", async () => {
      const process = await supervisor.resumeSession({
        sessionId: "sess-123",
        projectPath: "/tmp/test",
        message: { text: "continue" },
      });

      expect(process.sessionId).toBe("sess-123");
      expect(startCalls[0]?.resumeSessionId).toBe("sess-123");
    });

    it("sends to the live process of the same session", async () => {
      const request = { sessionId: "sess-123", projectPath: "/tmp/test" };
      const first = await supervisor.resumeSession({ ...request, message: { text: "first" } });
      const second = await supervisor.resumeSession({ ...request, message: { text: "second" } });

      expect(second).toBe(first);
      expect(startCalls).toHaveLength(1);
    });

    it("starts a separate process for a different session", async () => {
      const first = await supervisor.resumeSession({
        sessionId: "sess-123",
        projectPath: "/tmp/test",
        message: { text: "first" },
      });
      const second = await supervisor.resumeSession({
        sessionId: "sess-456",
        projectPath: "/tmp/test",
        message: { text: "second" },
      });

      expect(second.id).not.toBe(first.id);
    });

    it("restarts the process when the effort changes", async () => {
      const request = { sessionId: "sess-123", projectPath: "/tmp/test" };
      const first = await supervisor.resumeSession({ ...request, message: { text: "first" } });
      const second = await supervisor.resumeSession({
        ...request,
        message: { text: "think harder" },
        modelSettings: { effort: "high" },
      });

      expect(second.id).not.toBe(first.id);
      expect(startCalls[1]).toMatchObject({ resumeSessionId: "sess-123", effort: "high" });
    });

    it("starts a new process once the old one died", async () => {
      let started = 0;
      const dying = new Supervisor({
        provider: providerFromSessionFactory(async (options) => {
          started += 1;
          async function* events(): AsyncIterableIterator<AgentEvent> {
            yield { type: "session.started", sessionId: options.resumeSessionId ?? "dying-1" };
            throw new Error("process exited");
          }
          return { events: events(), queue: new MessageQueue(), abort: () => {} };
        }),
      });
      const request = { sessionId: "dying-1", projectPath: "/tmp/test" };
      const first = await dying.resumeSession({ ...request, message: { text: "first" } });
      await vi.waitFor(() => expect(first.isTerminated).toBe(true));

      const second = await dying.resumeSession({ ...request, message: { text: "again" } });

      expect(second.id).not.toBe(first.id);
      expect(started).toBe(2);
      await dying.close();
    });
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
          async function* events(): AsyncIterableIterator<AgentEvent> {
            yield { type: "session.started", sessionId: "idle-alive-session-1" };
            yield { type: "turn.completed" };
            while (!aborted) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return {
            events: events(),
            queue: new MessageQueue(),
            abort: () => {
              aborted = true;
            },
            isProcessAlive: () => !aborted,
          };
        }),
        idleTimeoutMs: 100,
      });

      const process = await idle.startSession({
        projectPath: "/tmp/test",
        message: { text: "Keep this session alive" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(process.state.type).toBe("idle");

      await vi.advanceTimersByTimeAsync(150);

      expect(aborted).toBe(true);
      expect(process.sessionId).toBe("idle-alive-session-1");
      // The session outlives its worker: the next message starts a new one.
      aborted = false;
      const next = await idle.resumeSession({
        sessionId: "idle-alive-session-1",
        projectPath: "/tmp/test",
        message: { text: "again" },
      });
      expect(next.id).not.toBe(process.id);
      expect(started).toBe(2);
      await idle.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
