import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../src/sdk/messageQueue.js";
import type { StartSessionOptions } from "../src/sdk/providers/types.js";
import { Supervisor } from "../src/supervisor/Supervisor.js";
import type { SessionSummary } from "../src/supervisor/types.js";
import { type BusEvent, EventBus } from "../src/watcher/EventBus.js";
import {
  createScriptedProvider,
  expectStarted,
  providerFromSessionFactory,
} from "./helpers/scriptedProvider.js";

describe("Supervisor", () => {
  let supervisor: Supervisor;

  beforeEach(() => {
    supervisor = new Supervisor({
      provider: createScriptedProvider({ reply: "Hello!" }),
      idleTimeoutMs: 100,
    });
  });

  describe("startSession", () => {
    it("starts a session and returns a process", async () => {
      const process = expectStarted(
        await supervisor.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );

      expect(process.id).toBeDefined();
      expect(process.projectPath).toBe("/tmp/test");
    });

    it("tracks process in getAllProcesses", async () => {
      await supervisor.startSession({ projectPath: "/tmp/test", message: { text: "hi" } });

      expect(supervisor.getAllProcesses()).toHaveLength(1);
    });

    it("encodes projectId correctly", async () => {
      const process = expectStarted(
        await supervisor.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );

      // /tmp/test in base64url
      expect(process.projectId).toBe(Buffer.from("/tmp/test").toString("base64url"));
    });

    it("queues the initial message", async () => {
      const process = expectStarted(
        await supervisor.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );

      // The message was queued
      expect(process.queueDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe("resumeSession", () => {
    it("resumes an existing session", async () => {
      const process = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "continue",
          },
        }),
      );

      expect(process.sessionId).toBe("sess-123");
    });

    it("reuses existing process for same session", async () => {
      const process1 = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "first",
          },
        }),
      );

      const process2 = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "second",
          },
        }),
      );

      expect(process1.id).toBe(process2.id);
    });

    it("creates new process for different session", async () => {
      const process1 = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "first",
          },
        }),
      );

      const process2 = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-456",
          projectPath: "/tmp/test",
          message: {
            text: "second",
          },
        }),
      );

      expect(process1.id).not.toBe(process2.id);
    });
  });

  describe("capacity queue launch options", () => {
    it("preserves model settings for queued new sessions", async () => {
      const startCalls: StartSessionOptions[] = [];
      const supervisorWithQueue = new Supervisor({
        provider: createScriptedProvider({ startCalls, holdOpen: true }),
        maxWorkers: 1,
        idleTimeoutMs: 60_000,
      });

      const active = expectStarted(
        await supervisorWithQueue.startSession({
          projectPath: "/tmp/test",
          message: { text: "first" },
        }),
      );
      const queued = await supervisorWithQueue.startSession({
        projectPath: "/tmp/test",
        message: { text: "second" },
        permissionMode: "plan",
        modelSettings: {
          model: "opus",
          thinking: { type: "adaptive" },
          effort: "high",
          globalInstructions: "Prefer concise answers.",
          executor: "remote-runner",
          remoteEnv: { REGION: "test-region" },
        },
      });

      expect(queued.kind).toBe("queued");
      await supervisorWithQueue.abortProcess(active.id);

      await vi.waitFor(() => expect(startCalls).toHaveLength(2));
      expect(startCalls[1]).toMatchObject({
        cwd: "/tmp/test",
        initialMessage: { text: "second" },
        permissionMode: "plan",
        model: "opus",
        thinking: { type: "adaptive" },
        effort: "high",
        globalInstructions: "Prefer concise answers.",
        executor: "remote-runner",
        remoteEnv: { REGION: "test-region" },
      });

      const startedQueuedProcess = supervisorWithQueue.getAllProcesses()[0];
      if (startedQueuedProcess) await supervisorWithQueue.abortProcess(startedQueuedProcess.id);
    });

    it("preserves model settings and resume id for queued resumes", async () => {
      const startCalls: StartSessionOptions[] = [];
      const supervisorWithQueue = new Supervisor({
        provider: createScriptedProvider({ startCalls, holdOpen: true }),
        maxWorkers: 1,
        idleTimeoutMs: 60_000,
      });

      const active = expectStarted(
        await supervisorWithQueue.startSession({
          projectPath: "/tmp/test",
          message: { text: "first" },
        }),
      );

      const queued = await supervisorWithQueue.resumeSession({
        sessionId: "resume-target",
        projectPath: "/tmp/test",
        message: { text: "continue" },
        permissionMode: "acceptEdits",
        modelSettings: {
          model: "sonnet",
          thinking: { type: "disabled" },
          effort: "medium",
          executor: "resume-executor",
        },
      });

      expect(queued.kind).toBe("queued");
      await supervisorWithQueue.abortProcess(active.id);

      await vi.waitFor(() => expect(startCalls).toHaveLength(2));
      expect(startCalls[1]).toMatchObject({
        cwd: "/tmp/test",
        initialMessage: { text: "continue" },
        resumeSessionId: "resume-target",
        permissionMode: "acceptEdits",
        model: "sonnet",
        thinking: { type: "disabled" },
        effort: "medium",
        executor: "resume-executor",
      });

      const startedQueuedProcess = supervisorWithQueue.getAllProcesses()[0];
      if (startedQueuedProcess) await supervisorWithQueue.abortProcess(startedQueuedProcess.id);
    });

    it("preserves create-only semantics for queued session creation", async () => {
      const startCalls: StartSessionOptions[] = [];
      const supervisorWithQueue = new Supervisor({
        provider: createScriptedProvider({ startCalls, holdOpen: true }),
        maxWorkers: 1,
        idleTimeoutMs: 60_000,
      });

      const active = expectStarted(
        await supervisorWithQueue.startSession({
          projectPath: "/tmp/test",
          message: { text: "first" },
        }),
      );

      const queued = await supervisorWithQueue.createSession({
        projectPath: "/tmp/test",
        permissionMode: "plan",
        modelSettings: {
          model: "haiku",
          thinking: { type: "adaptive" },
          effort: "low",
        },
      });

      expect(queued.kind).toBe("queued");
      await supervisorWithQueue.abortProcess(active.id);

      await vi.waitFor(() => expect(startCalls).toHaveLength(2));
      expect(startCalls[1]).toMatchObject({
        cwd: "/tmp/test",
        permissionMode: "plan",
        model: "haiku",
        thinking: { type: "adaptive" },
        effort: "low",
      });
      expect(startCalls[1]?.initialMessage).toBeUndefined();

      const startedQueuedProcess = supervisorWithQueue.getAllProcesses()[0];
      if (startedQueuedProcess) await supervisorWithQueue.abortProcess(startedQueuedProcess.id);
    });
  });

  describe("getProcess", () => {
    it("returns process by id", async () => {
      const process = expectStarted(
        await supervisor.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );
      const found = supervisor.getProcess(process.id);

      expect(found).toBe(process);
    });

    it("returns undefined for unknown id", () => {
      const found = supervisor.getProcess("unknown-id");
      expect(found).toBeUndefined();
    });
  });

  describe("getProcessForSession", () => {
    it("returns process by session id", async () => {
      const process = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );
      const found = supervisor.getProcessForSession("sess-123");

      expect(found).toBe(process);
    });

    it("returns undefined for unknown session", () => {
      const found = supervisor.getProcessForSession("unknown-session");
      expect(found).toBeUndefined();
    });
  });

  describe("getProcessInfoList", () => {
    it("returns info for all processes", async () => {
      await supervisor.startSession({ projectPath: "/tmp/test1", message: { text: "one" } });
      await supervisor.startSession({ projectPath: "/tmp/test2", message: { text: "two" } });

      const infoList = supervisor.getProcessInfoList();

      expect(infoList).toHaveLength(2);
      expect(infoList[0]?.id).toBeDefined();
      expect(infoList[1]?.id).toBeDefined();
    });
  });

  describe("abortProcess", () => {
    it("aborts and removes process", async () => {
      const process = expectStarted(
        await supervisor.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );

      const result = await supervisor.abortProcess(process.id);

      expect(result).toBe(true);
      expect(supervisor.getAllProcesses()).toHaveLength(0);
    });

    it("returns false for unknown process", async () => {
      const result = await supervisor.abortProcess("unknown-id");
      expect(result).toBe(false);
    });

    it("removes session mapping on abort", async () => {
      const process = expectStarted(
        await supervisor.resumeSession({
          sessionId: "sess-123",
          projectPath: "/tmp/test",
          message: {
            text: "hi",
          },
        }),
      );

      await supervisor.abortProcess(process.id);

      expect(supervisor.getProcessForSession("sess-123")).toBeUndefined();
    });
  });

  describe("eventBus integration", () => {
    it("emits process-state-changed event when session starts", async () => {
      const eventBus = new EventBus();
      const events: BusEvent[] = [];
      eventBus.subscribe((event) => events.push(event));

      const supervisorWithBus = new Supervisor({
        provider: createScriptedProvider({ reply: "Hello!" }),
        idleTimeoutMs: 100,
        eventBus,
      });

      await supervisorWithBus.startSession({ projectPath: "/tmp/test", message: { text: "hi" } });

      // Find process-state-changed events
      const processStateEvents = events.filter((e) => e.type === "process-state-changed");

      console.log(
        "All events emitted:",
        events.map((e) => e.type),
      );
      console.log("Process state events:", processStateEvents);

      expect(processStateEvents.length).toBeGreaterThanOrEqual(1);
      expect(processStateEvents[0]).toMatchObject({
        type: "process-state-changed",
        activity: "in-turn",
      });
    });

    it("emits session-status-changed event when session starts", async () => {
      const eventBus = new EventBus();
      const events: BusEvent[] = [];
      eventBus.subscribe((event) => events.push(event));

      const supervisorWithBus = new Supervisor({
        provider: createScriptedProvider({ reply: "Hello!" }),
        idleTimeoutMs: 100,
        eventBus,
      });

      await supervisorWithBus.startSession({ projectPath: "/tmp/test", message: { text: "hi" } });

      // Find session-status-changed events
      const statusEvents = events.filter((e) => e.type === "session-status-changed");

      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0]).toMatchObject({
        type: "session-status-changed",
        ownership: { owner: "self" },
      });
    });

    it("emits optimistic title/messageCount in session-created for real SDK sessions", async () => {
      const eventBus = new EventBus();
      const events: BusEvent[] = [];
      eventBus.subscribe((event) => events.push(event));

      const realSdk = {
        startSession: async () => {
          async function* iterator() {
            yield { type: "session.started" as const, sessionId: "real-session-1" };
            yield { type: "turn.completed" as const };
          }
          return {
            events: iterator(),
            queue: new MessageQueue(),
            abort: () => {},
          };
        },
      };

      const supervisorWithBus = new Supervisor({
        provider: providerFromSessionFactory(realSdk.startSession),
        idleTimeoutMs: 100,
        eventBus,
      });

      await supervisorWithBus.startSession({
        projectPath: "/tmp/test",
        message: {
          text: "Optimistic title from request",
        },
      });

      const created = events.find(
        (e): e is Extract<BusEvent, { type: "session-created" }> => e.type === "session-created",
      );
      expect(created).toBeDefined();
      expect(created?.session.title).toBe("Optimistic title from request");
      expect(created?.session.messageCount).toBe(1);
    });

    it("emits timed session-updated reconciliation from onSessionSummary", async () => {
      vi.useFakeTimers();
      try {
        const eventBus = new EventBus();
        const events: BusEvent[] = [];
        eventBus.subscribe((event) => events.push(event));

        const realSdk = {
          startSession: async () => {
            async function* iterator() {
              yield { type: "session.started" as const, sessionId: "reconcile-session-1" };
            }
            return {
              events: iterator(),
              queue: new MessageQueue(),
              abort: () => {},
            };
          },
        };

        const onSessionSummary = vi.fn(
          async (sessionId: string, projectId: string): Promise<SessionSummary | null> => ({
            id: sessionId,
            projectId,
            title: "Reconciled title",
            fullTitle: "Reconciled title",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(1000).toISOString(),
            messageCount: 1,
            ownership: { owner: "self", processId: "test-proc" },
            provider: "claude",
          }),
        );

        const supervisorWithBus = new Supervisor({
          provider: providerFromSessionFactory(realSdk.startSession),
          idleTimeoutMs: 100,
          eventBus,
          onSessionSummary,
        });

        await supervisorWithBus.startSession({
          projectPath: "/tmp/test",
          message: {
            text: "Seed title",
          },
        });

        // Allow init event and first reconciliation window.
        await vi.advanceTimersByTimeAsync(20);
        await vi.advanceTimersByTimeAsync(1100);

        expect(onSessionSummary).toHaveBeenCalled();

        const updated = events.find(
          (event): event is Extract<BusEvent, { type: "session-updated" }> =>
            event.type === "session-updated" && event.sessionId === "reconcile-session-1",
        );
        expect(updated).toBeDefined();
        expect(updated?.title).toBe("Reconciled title");
        expect(updated?.messageCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits process-terminated when the underlying process exits unexpectedly", async () => {
      const eventBus = new EventBus();
      const events: BusEvent[] = [];
      eventBus.subscribe((event) => events.push(event));

      const realSdk = {
        startSession: async () => {
          async function* iterator() {
            yield { type: "session.started" as const, sessionId: "terminated-session-1" };
            throw new Error("process exited");
          }

          return {
            events: iterator(),
            queue: new MessageQueue(),
            abort: () => {},
          };
        },
      };

      const supervisorWithBus = new Supervisor({
        provider: providerFromSessionFactory(realSdk.startSession),
        idleTimeoutMs: 100,
        eventBus,
      });

      await supervisorWithBus.startSession({
        projectPath: "/tmp/test",
        message: {
          text: "Trigger failure",
        },
      });

      await vi.waitFor(() => {
        expect(events.some((event) => event.type === "process-terminated")).toBe(true);
      });

      const terminated = events.find(
        (event): event is Extract<BusEvent, { type: "process-terminated" }> =>
          event.type === "process-terminated",
      );
      expect(terminated).toMatchObject({
        type: "process-terminated",
        sessionId: "terminated-session-1",
        reason: "underlying process terminated",
      });
    });

    it("releases live idle workers after the configured timeout", async () => {
      vi.useFakeTimers();
      try {
        let aborted = false;

        const realSdk = {
          startSession: async () => {
            async function* iterator() {
              yield { type: "session.started" as const, sessionId: "idle-alive-session-1" };
              yield { type: "turn.completed" as const };

              while (!aborted) {
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            }

            return {
              events: iterator(),
              queue: new MessageQueue(),
              abort: () => {
                aborted = true;
              },
              isProcessAlive: () => !aborted,
            };
          },
        };

        const supervisorWithAliveProcess = new Supervisor({
          provider: providerFromSessionFactory(realSdk.startSession),
          idleTimeoutMs: 100,
        });

        const process = expectStarted(
          await supervisorWithAliveProcess.startSession({
            projectPath: "/tmp/test",
            message: {
              text: "Keep this session alive",
            },
          }),
        );

        await vi.advanceTimersByTimeAsync(0);
        expect(process.state.type).toBe("idle");

        await vi.advanceTimersByTimeAsync(150);

        expect(
          supervisorWithAliveProcess.getProcessForSession("idle-alive-session-1"),
        ).toBeUndefined();
        expect(aborted).toBe(true);
        expect(process.sessionId).toBe("idle-alive-session-1");
        await supervisorWithAliveProcess.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
