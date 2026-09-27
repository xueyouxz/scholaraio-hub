import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MessageQueue } from "../src/providers/MessageQueue.js";
import { toClaudeUserMessage } from "../src/providers/claude/ClaudeSession.js";
import type { AgentEvent } from "../src/providers/events.js";
import type { AgentSession, UserMessage } from "../src/providers/types.js";
import {
  AgentProcess,
  type AgentProcessOptions,
  type ProcessEvent,
} from "../src/supervisor/AgentProcess.js";

/** A provider stream that yields `events`, then stays open like a live CLI. */
function openStream(events: AgentEvent[] = []): AsyncIterableIterator<AgentEvent> {
  let index = 0;
  const stream: AsyncIterableIterator<AgentEvent> = {
    next: () =>
      index < events.length
        ? Promise.resolve({ done: false as const, value: events[index++] as AgentEvent })
        : new Promise<IteratorResult<AgentEvent>>(() => {}),
    [Symbol.asyncIterator]: () => stream,
  };
  return stream;
}

function start(
  options: Partial<AgentProcessOptions> & {
    events?: AsyncIterableIterator<AgentEvent>;
    session?: Partial<AgentSession>;
  } = {},
) {
  const { events, session: overrides, ...rest } = options;
  const session: AgentSession = {
    events: events ?? openStream(),
    queue: new MessageQueue(),
    abort: vi.fn(),
    ...overrides,
  };
  const process = new AgentProcess(session, {
    sessionId: "sess-1",
    projectPath: "/test",
    provider: "claude",
    idleTimeoutMs: 100,
    ...rest,
  });
  return { process, session };
}

/** The approval the process is waiting on, as its subscribers see it. */
function pendingInput(process: AgentProcess) {
  return process.state.type === "waiting-input" ? process.state.request : null;
}

const signal = new AbortController().signal;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("AgentProcess", () => {
  it("releases a live idle worker while retaining its native session ID", async () => {
    const { process, session } = start({
      events: openStream([{ type: "turn.completed" }]),
      nativeSessionId: "native-idle",
      idleTimeoutMs: 20,
    });
    await expect.poll(() => process.state.type).toBe("terminated");
    expect(session.abort).toHaveBeenCalledOnce();
    expect(process.nativeSessionId).toBe("native-idle");
    expect(process.queueMessage({ text: "continue" }).success).toBe(false);
  });

  describe("event subscription", () => {
    it("relays provider events and learns the native id and model from them", async () => {
      const { process } = start({
        events: openStream([
          { type: "session.started", sessionId: "native-1" },
          { type: "model.resolved", model: "opus-4" },
          { type: "text.delta", blockId: "b1", delta: "Hi" },
          { type: "turn.completed" },
        ]),
      });
      const received: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") received.push(event.event);
      });
      await wait(20);
      expect(received.map((event) => event.type)).toEqual([
        "session.started",
        "model.resolved",
        "text.delta",
        "turn.completed",
      ]);
      expect(process.sessionId).toBe("sess-1");
      expect(process.nativeSessionId).toBe("native-1");
      expect(process.resolvedModel).toBe("opus-4");
    });

    it("goes idle when a turn completes", async () => {
      const { process } = start({ events: openStream([{ type: "turn.completed" }]) });
      const states: ProcessEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "state-change") states.push(event);
      });
      await wait(20);
      expect(process.state.type).toBe("idle");
      expect(states.at(-1)).toEqual({ type: "state-change", state: { type: "idle" } });
    });
  });

  describe("message queue", () => {
    it("queues messages for the provider in order", async () => {
      const { process, session } = start();
      expect(process.queueMessage({ text: "first" }).success).toBe(true);
      expect(process.queueMessage({ text: "second" }).success).toBe(true);
      const sent = session.queue.messages();
      expect((await sent.next()).value?.text).toBe("first");
      expect((await sent.next()).value?.text).toBe("second");
    });

    it("queues a message sent while the provider is still in its turn", async () => {
      const { process, session } = start();
      expect(process.queueMessage({ text: "next" }).success).toBe(true);
      expect((await session.queue.messages().next()).value?.text).toBe("next");
    });
  });

  describe("provider activity", () => {
    it("counts provider work while idle as a turn, so the idle timeout does not stop it", async () => {
      let emit: (event: AgentEvent) => void = () => {};
      const events: AsyncIterableIterator<AgentEvent> = {
        next: () =>
          new Promise((resolve) => {
            emit = (value) => resolve({ done: false, value });
          }),
        [Symbol.asyncIterator]: () => events,
      };
      const { process } = start({ events, idleTimeoutMs: 30 });
      await wait(0);
      emit({ type: "turn.completed" });
      await expect.poll(() => process.state.type).toBe("idle");
      emit({ type: "text.delta", blockId: "b", delta: "background work" });
      await expect.poll(() => process.state.type).toBe("in-turn");
      await wait(60);
      expect(process.isTerminated).toBe(false);
      process.stop("done");
    });

    it("aborts the provider session when its stream ends on its own", async () => {
      const events: AsyncIterableIterator<AgentEvent> = {
        next: async () => ({ done: true, value: undefined }),
        [Symbol.asyncIterator]: () => events,
      };
      const { process, session } = start({ events });
      await expect.poll(() => process.isTerminated).toBe(true);
      expect(session.abort).toHaveBeenCalledOnce();
    });
  });

  describe("stop", () => {
    it("kills the CLI and reports the ending once", () => {
      const { process, session } = start();
      const endings: ProcessEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "terminated") endings.push(event);
      });
      process.stop("User stopped");
      process.stop("again");
      expect(session.abort).toHaveBeenCalledOnce();
      expect(endings).toEqual([{ type: "terminated", reason: "User stopped", error: undefined }]);
      expect(process.terminationReason).toBe("User stopped");
    });

    it("denies approvals still waiting", async () => {
      const { process } = start();
      const approval = process.handleToolApproval("Bash", { command: "ls" }, { signal });
      process.stop("User stopped");
      expect((await approval).behavior).toBe("deny");
    });
  });

  describe("permission mode", () => {
    it("defaults to 'default' mode and can change", () => {
      const { process } = start();
      expect(process.permissionMode).toBe("default");
      process.setPermissionMode("plan");
      expect(process.permissionMode).toBe("plan");
    });

    it("tells the provider about a new mode once", () => {
      const setPermissionMode = vi.fn();
      const { process } = start({ session: { setPermissionMode } });
      process.setPermissionMode("acceptEdits");
      process.setPermissionMode("acceptEdits");
      expect(setPermissionMode).toHaveBeenCalledOnce();
      expect(setPermissionMode).toHaveBeenCalledWith("acceptEdits");
    });

    it("auto-approves everything in bypassPermissions mode", async () => {
      const { process } = start({ permissionMode: "bypassPermissions" });
      const result = await process.handleToolApproval("Bash", { command: "rm -rf /" }, { signal });
      expect(result.behavior).toBe("allow");
    });

    it("auto-allows read-only tools in plan mode", async () => {
      const { process } = start({ permissionMode: "plan" });
      for (const tool of ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]) {
        expect((await process.handleToolApproval(tool, {}, { signal })).behavior).toBe("allow");
      }
    });

    it("asks before mutating tools in plan mode", async () => {
      const { process } = start({ permissionMode: "plan" });
      const approval = process.handleToolApproval("Edit", { file: "test.ts" }, { signal });
      const request = pendingInput(process);
      expect(request?.toolName).toBe("Edit");
      process.respondToInput(request?.id ?? "", "deny");
      expect(await approval).toMatchObject({ behavior: "deny", interrupt: true });
    });

    it("asks before ExitPlanMode, and leaves the mode switch to the session", async () => {
      const { process } = start({ permissionMode: "plan" });
      const approval = process.handleToolApproval("ExitPlanMode", {}, { signal });
      const request = pendingInput(process);
      expect(process.respondToInput(request?.id ?? "", "approve")).toMatchObject({
        toolName: "ExitPlanMode",
      });
      expect((await approval).behavior).toBe("allow");
      expect(process.permissionMode).toBe("plan");
    });

    it("passes AskUserQuestion answers as the tool's updated input", async () => {
      const { process } = start({ permissionMode: "plan" });
      const questions = [{ question: "test?", header: "Test", options: [] }];
      const approval = process.handleToolApproval("AskUserQuestion", { questions }, { signal });
      process.respondToInput(pendingInput(process)?.id ?? "", "approve", { "test?": "Yes" });
      expect(await approval).toEqual({
        behavior: "allow",
        updatedInput: { questions, answers: { "test?": "Yes" } },
      });
    });

    it("auto-approves edits in acceptEdits mode", async () => {
      const { process } = start({ permissionMode: "acceptEdits" });
      for (const tool of ["Edit", "Write"]) {
        expect((await process.handleToolApproval(tool, {}, { signal })).behavior).toBe("allow");
      }
    });

    it("auto-allows read-only tools in default and acceptEdits modes", async () => {
      for (const permissionMode of ["default", "acceptEdits"] as const) {
        const { process } = start({ permissionMode });
        for (const tool of ["Read", "Glob", "Grep", "LSP", "WebFetch", "WebSearch", "Task"]) {
          expect((await process.handleToolApproval(tool, {}, { signal })).behavior).toBe("allow");
        }
      }
    });

    it("keeps acceptEdits at least as permissive as default", () => {
      const tools = ["Read", "Grep", "Task", "Edit", "Write", "NotebookEdit", "Bash"];
      for (const tool of tools) {
        const asks = (permissionMode: "default" | "acceptEdits") => {
          const { process } = start({ permissionMode });
          void process.handleToolApproval(tool, {}, { signal });
          return process.state.type === "waiting-input";
        };
        if (!asks("default")) expect(asks("acceptEdits")).toBe(false);
      }
    });

    it("puts concurrent approvals to the user one at a time", async () => {
      const { process } = start();
      const first = process.handleToolApproval("Bash", { command: "ls -la" }, { signal });
      const second = process.handleToolApproval("Bash", { command: "pwd" }, { signal });
      const firstRequest = pendingInput(process);
      expect(firstRequest?.toolInput).toEqual({ command: "ls -la" });
      expect(process.respondToInput(firstRequest?.id ?? "", "approve")).toBeDefined();
      expect((await first).behavior).toBe("allow");
      const secondRequest = pendingInput(process);
      expect(secondRequest?.toolInput).toEqual({ command: "pwd" });
      process.respondToInput(secondRequest?.id ?? "", "approve");
      expect((await second).behavior).toBe("allow");
      expect(process.state.type).toBe("in-turn");
    });

    it("moves on when the approval shown is aborted after an earlier one was answered", async () => {
      const { process } = start();
      const turn = new AbortController();
      const first = process.handleToolApproval("Bash", { command: "ls" }, { signal });
      const second = process.handleToolApproval("Bash", { command: "pwd" }, turn);
      process.respondToInput(pendingInput(process)?.id ?? "", "approve");
      await first;
      turn.abort();
      expect((await second).behavior).toBe("deny");
      expect(process.state.type).toBe("in-turn");
    });

    it("denies the stopped turn's approvals when interrupted, so later ones are shown", async () => {
      const { process } = start({ session: { interrupt: vi.fn(async () => {}) } });
      // A provider whose interrupt does not abort the approval's signal.
      const stale = process.handleToolApproval("Bash", { command: "ls" }, { signal });
      await process.interrupt();
      expect((await stale).behavior).toBe("deny");
      expect(process.state.type).toBe("in-turn");
      void process.handleToolApproval("Bash", { command: "pwd" }, { signal });
      expect(pendingInput(process)?.toolInput).toEqual({ command: "pwd" });
      process.stop("done");
    });

    it("denies approvals the finished turn left open", async () => {
      const { process } = start({
        events: openStream([{ type: "turn.completed" }]),
        idleTimeoutMs: 60_000,
      });
      const leftOpen = process.handleToolApproval("Bash", { command: "ls" }, { signal });
      expect((await leftOpen).behavior).toBe("deny");
      await expect.poll(() => process.state.type).toBe("idle");
      process.stop("done");
    });

    it("answers nothing for an unknown request", () => {
      const { process } = start();
      expect(process.respondToInput("missing", "approve")).toBeUndefined();
    });
  });

  it("names the tool call an approval is about, so the UI can ask on its row", () => {
    const { process } = start();
    const controller = new AbortController();
    void process.handleToolApproval(
      "Bash",
      { command: "rm -rf build" },
      { signal: controller.signal, toolUseID: "call-9" },
    );
    expect(pendingInput(process)).toMatchObject({
      sessionId: "sess-1",
      toolName: "Bash",
      toolCallId: "call-9",
    });
    controller.abort();
  });

  describe("queued user messages", () => {
    it("reaches Claude as text naming every file, with images also inline", async () => {
      const { process, session } = start();
      const dir = await mkdtemp(join(tmpdir(), "hub-queue-"));
      const screenshot = join(dir, "screenshot.png");
      await writeFile(screenshot, Buffer.from("png-bytes"));
      process.queueMessage({
        text: "Here is a screenshot",
        attachments: [
          {
            id: "file-1",
            originalName: "screenshot.png",
            name: "screenshot.png",
            size: 1024,
            mimeType: "image/png",
            path: screenshot,
          },
          {
            id: "file-2",
            originalName: "document.pdf",
            name: "document.pdf",
            size: 2048576,
            mimeType: "application/pdf",
            path: "/uploads/document.pdf",
          },
        ],
      });
      const queued = await session.queue.messages().next();
      const sent = await toClaudeUserMessage(queued.value as UserMessage);
      const content = sent.message.content as Array<{
        type: string;
        text?: string;
        source?: { media_type: string; data: string };
      }>;
      // The text lists every file by path; the image also goes inline.
      expect(content[0]?.text).toContain("User uploaded files:");
      expect(content[0]?.text).toContain("1.0 KB");
      expect(content.slice(1)).toEqual([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from("png-bytes").toString("base64"),
          },
        },
      ]);
      await rm(dir, { recursive: true, force: true });
    });

    it("does not echo user input onto the agent event stream", () => {
      const { process } = start();
      const agentEvents: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") agentEvents.push(event.event);
      });
      process.queueMessage({ text: "test message" });
      expect(agentEvents).toEqual([]);
    });
  });

  describe("ending", () => {
    it("is live until something ends it", () => {
      const { process } = start();
      expect(process.isTerminated).toBe(false);
      expect(process.terminationReason).toBe(null);
    });

    it("ends when the provider's stream ends, and takes no more messages", async () => {
      async function* finite(): AsyncIterableIterator<AgentEvent> {
        yield { type: "turn.completed" };
      }
      const { process } = start({ events: finite() });
      await vi.waitFor(() => expect(process.terminationReason).toBe("provider stream ended"));
      const result = process.queueMessage({ text: "should fail" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("terminated");
    });

    it("ends with the error when the provider's stream fails", async () => {
      const error = new Error("ProcessTransport is not ready for writing");
      async function* failing(): AsyncIterableIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "native-1" };
        throw error;
      }
      const { process } = start({ events: failing() });
      let ending: ProcessEvent | undefined;
      process.subscribe((event) => {
        if (event.type === "terminated") ending = event;
      });
      await vi.waitFor(() => expect(ending).toBeDefined());
      expect(ending).toEqual({ type: "terminated", reason: "provider stream failed", error });
    });
  });
});
