import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/agent/events.js";
import { MessageQueue } from "../src/sdk/messageQueue.js";
import { resolveSessionControls } from "../src/sdk/providers/session-capabilities.js";
import type { AgentSession } from "../src/sdk/providers/types.js";
import { Process } from "../src/supervisor/Process.js";
import type { ProcessEvent } from "../src/supervisor/types.js";

function createMockIterator(messages: AgentEvent[]): AsyncIterator<AgentEvent> {
  let index = 0;
  return {
    async next() {
      if (index >= messages.length) {
        return { done: true as const, value: undefined };
      }
      return { done: false as const, value: messages[index++] };
    },
  };
}

/** The approval the process is waiting on, as its subscribers see it. */
function pendingInput(process: Process) {
  return process.state.type === "waiting-input" ? process.state.request : null;
}

describe("Process", () => {
  it("releases a live idle worker while retaining its native session ID", async () => {
    const abort = vi.fn();
    const process = new Process(createMockIterator([{ type: "turn.completed" }]), {
      queue: new MessageQueue(),
      projectPath: "/test",
      sessionId: "native-idle",
      idleTimeoutMs: 20,
      abortFn: abort,
      isProcessAlive: () => true,
    });
    await expect.poll(() => process.state.type).toBe("terminated");
    expect(abort).toHaveBeenCalledOnce();
    expect(process.sessionId).toBe("native-idle");
    expect(process.queueMessage({ text: "continue" }).success).toBe(false);
  });
  describe("event subscription", () => {
    it("emits message events", async () => {
      const messages: AgentEvent[] = [
        { type: "session.started", sessionId: "sess-1" },
        { type: "text.delta", blockId: "b1", delta: "Hi" },
        { type: "turn.completed" },
      ];

      const iterator = createMockIterator(messages);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const received: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") {
          received.push(event.event);
        }
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
      expect(received.map((event) => event.type)).toEqual([
        "session.started",
        "text.delta",
        "turn.completed",
      ]);
    });

    it("transitions to idle after result", async () => {
      const messages: AgentEvent[] = [
        { type: "session.started", sessionId: "sess-1" },
        { type: "turn.completed" },
      ];

      const iterator = createMockIterator(messages);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(process.state.type).toBe("idle");
    });

    it("emits state-change events", async () => {
      const messages: AgentEvent[] = [
        { type: "session.started", sessionId: "sess-1" },
        { type: "turn.completed" },
      ];

      const iterator = createMockIterator(messages);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const stateChanges: ProcessEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "state-change") {
          stateChanges.push(event);
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have at least one state change to idle
      expect(stateChanges.length).toBeGreaterThan(0);
      const lastChange = stateChanges[stateChanges.length - 1];
      expect(lastChange?.type).toBe("state-change");
      if (lastChange?.type === "state-change") {
        expect(lastChange.state.type).toBe("idle");
      }
    });
  });

  describe("message queue", () => {
    it("queues messages and returns position", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const result1 = process.queueMessage({ text: "first" });
      const result2 = process.queueMessage({ text: "second" });

      expect(result1.success).toBe(true);
      expect(result1.position).toBe(1);
      expect(result2.success).toBe(true);
      expect(result2.position).toBe(2);
    });

    it("prefers steerFn for in-turn messages when available", async () => {
      let resolveIterator: () => void;
      const iterator: AsyncIterator<AgentEvent> = {
        next: () =>
          new Promise((resolve) => {
            resolveIterator = () => resolve({ done: true, value: undefined });
          }),
      };
      const queue = new MessageQueue();
      const steerFn = vi.fn(async () => true);

      const process = new Process(iterator, {
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        queue,
        controls: resolveSessionControls({ steer: steerFn } as unknown as AgentSession),
      });

      const result = process.queueMessage({ text: "steer me" });

      expect(result.success).toBe(true);
      expect(result.position).toBe(0);
      expect(steerFn).toHaveBeenCalledTimes(1);
      expect(queue.depth).toBe(0);

      // Let the iterator complete so abort() doesn't hang
      resolveIterator?.();
      await process.abort();
    });

    it("falls back to queue when steerFn returns false", async () => {
      let resolveIterator: () => void;
      const iterator: AsyncIterator<AgentEvent> = {
        next: () =>
          new Promise((resolve) => {
            resolveIterator = () => resolve({ done: true, value: undefined });
          }),
      };
      const queue = new MessageQueue();
      const steerFn = vi.fn(async () => false);

      const process = new Process(iterator, {
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        queue,
        controls: resolveSessionControls({ steer: steerFn } as unknown as AgentSession),
      });

      const result = process.queueMessage({ text: "fallback me" });
      expect(result.success).toBe(true);
      expect(result.position).toBe(0);

      // steerFn returns a resolved promise, then .then() pushes to queue —
      // need 2 microtask ticks for both to settle
      await Promise.resolve();
      await Promise.resolve();
      expect(queue.depth).toBe(1);

      // Let the iterator complete so abort() doesn't hang
      resolveIterator?.();
      await process.abort();
    });
  });

  describe("abort", () => {
    it("emits complete event on abort", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      let completed = false;
      process.subscribe((event) => {
        if (event.type === "complete") {
          completed = true;
        }
      });

      await process.abort();

      expect(completed).toBe(true);
    });

    it("clears listeners after abort", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      let completeCount = 0;
      process.subscribe((event) => {
        if (event.type === "complete") {
          completeCount++;
        }
      });

      await process.abort();

      // Listener should have been called once for complete event
      expect(completeCount).toBe(1);
    });
  });

  describe("permission mode", () => {
    it("defaults to 'default' mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.permissionMode).toBe("default");
    });

    it("accepts initial permission mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "acceptEdits",
      });

      expect(process.permissionMode).toBe("acceptEdits");
    });

    it("allows changing permission mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.setPermissionMode("bypassPermissions");
      expect(process.permissionMode).toBe("bypassPermissions");

      process.setPermissionMode("plan");
      expect(process.permissionMode).toBe("plan");
    });

    it("handleToolApproval auto-approves in bypassPermissions mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "bypassPermissions",
      });

      const abortController = new AbortController();
      const result = await process.handleToolApproval(
        "Bash",
        { command: "rm -rf /" },
        { signal: abortController.signal },
      );

      expect(result.behavior).toBe("allow");
    });

    it("handleToolApproval auto-allows read-only tools in plan mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "plan",
      });

      const abortController = new AbortController();

      // Read-only tools should be auto-allowed in plan mode
      for (const tool of ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]) {
        const result = await process.handleToolApproval(
          tool,
          {},
          { signal: abortController.signal },
        );
        expect(result.behavior).toBe("allow");
      }
    });

    it("handleToolApproval prompts user for mutating tools in plan mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "plan",
      });

      const abortController = new AbortController();

      // Edit should prompt the user, not auto-deny
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      // Should be in waiting-input state (prompting user)
      expect(process.state.type).toBe("waiting-input");

      // Simulate user denying
      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();
      expect(pendingRequest?.toolName).toBe("Edit");
      process.respondToInput(pendingRequest?.id ?? "", "deny");

      const result = await approvalPromise;
      expect(result.behavior).toBe("deny");
    });

    it("queues deny feedback as follow-up message for Codex approvals", async () => {
      const queue = new MessageQueue();
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        provider: "codex",
        queue,
      });

      const abortController = new AbortController();
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();

      const accepted = process.respondToInput(
        pendingRequest?.id ?? "",
        "deny",
        undefined,
        "edit src/foo.ts instead",
      );

      expect(accepted).toBe(true);
      const result = await approvalPromise;
      expect(result.behavior).toBe("deny");
      expect(result.message).toBe("edit src/foo.ts instead");
      expect(result.interrupt).toBe(false);
      expect(queue.depth).toBe(1);
    });

    it("does not queue deny feedback follow-up for non-Codex providers", async () => {
      const queue = new MessageQueue();
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        provider: "claude",
        queue,
      });

      const abortController = new AbortController();
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();

      const accepted = process.respondToInput(
        pendingRequest?.id ?? "",
        "deny",
        undefined,
        "edit src/foo.ts instead",
      );

      expect(accepted).toBe(true);
      const result = await approvalPromise;
      expect(result.behavior).toBe("deny");
      expect(result.message).toBe("edit src/foo.ts instead");
      expect(result.interrupt).toBe(false);
      expect(queue.depth).toBe(0);
    });

    it("handleToolApproval prompts user for ExitPlanMode in plan mode (not auto-approve)", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "plan",
      });

      const abortController = new AbortController();

      // ExitPlanMode should NOT auto-approve - it should prompt the user
      const approvalPromise = process.handleToolApproval(
        "ExitPlanMode",
        {},
        { signal: abortController.signal },
      );

      // Should be in waiting-input state (prompting user)
      expect(process.state.type).toBe("waiting-input");

      // Simulate user approving
      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();
      expect(pendingRequest?.toolName).toBe("ExitPlanMode");
      process.respondToInput(pendingRequest?.id, "approve");

      const result = await approvalPromise;
      expect(result.behavior).toBe("allow");
      // After approval, should switch back to default mode
      expect(process.permissionMode).toBe("default");
    });

    it("handleToolApproval prompts user for AskUserQuestion in plan mode (not auto-deny)", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "plan",
      });

      const abortController = new AbortController();

      // AskUserQuestion should NOT auto-deny - it should prompt the user
      const approvalPromise = process.handleToolApproval(
        "AskUserQuestion",
        { questions: [{ question: "test?", header: "Test", options: [] }] },
        { signal: abortController.signal },
      );

      // Should be in waiting-input state (prompting user)
      expect(process.state.type).toBe("waiting-input");

      // Simulate user approving with answers
      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();
      expect(pendingRequest?.toolName).toBe("AskUserQuestion");
      process.respondToInput(pendingRequest?.id, "approve", { "test?": "Yes" });

      const result = await approvalPromise;
      expect(result.behavior).toBe("allow");
      // Should have updated input with answers
      expect(result.updatedInput).toEqual({
        questions: [{ question: "test?", header: "Test", options: [] }],
        answers: { "test?": "Yes" },
      });
      // Should still be in plan mode (AskUserQuestion doesn't exit plan mode)
      expect(process.permissionMode).toBe("plan");
    });

    it("handleToolApproval auto-approves Edit tools in acceptEdits mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "acceptEdits",
      });

      const abortController = new AbortController();

      // Edit should be auto-approved
      const editResult = await process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );
      expect(editResult.behavior).toBe("allow");

      // Write should be auto-approved
      const writeResult = await process.handleToolApproval(
        "Write",
        { file: "test.ts" },
        { signal: abortController.signal },
      );
      expect(writeResult.behavior).toBe("allow");
    });

    it("handleToolApproval auto-allows read-only tools in default mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "default",
      });

      const abortController = new AbortController();

      // Read-only tools should be auto-allowed in default mode (ask before EDITS, not reads)
      for (const tool of [
        "Read",
        "Glob",
        "Grep",
        "LSP",
        "WebFetch",
        "WebSearch",
        "Task",
        "TaskOutput",
      ]) {
        const result = await process.handleToolApproval(
          tool,
          {},
          { signal: abortController.signal },
        );
        expect(result.behavior).toBe("allow");
      }
    });

    it("handleToolApproval auto-allows read-only tools in acceptEdits mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "acceptEdits",
      });

      const abortController = new AbortController();

      // Read-only tools should also be auto-allowed in acceptEdits mode
      // (acceptEdits is strictly more permissive than default)
      for (const tool of [
        "Read",
        "Glob",
        "Grep",
        "LSP",
        "WebFetch",
        "WebSearch",
        "Task",
        "TaskOutput",
      ]) {
        const result = await process.handleToolApproval(
          tool,
          {},
          { signal: abortController.signal },
        );
        expect(result.behavior).toBe("allow");
      }
    });

    it("acceptEdits mode is strictly more permissive than default mode", async () => {
      // This test ensures the permission hierarchy is maintained:
      // bypassPermissions > acceptEdits > default > plan
      // Any tool auto-approved in default should also be auto-approved in acceptEdits
      const abortController = new AbortController();

      // Test all common tools across both modes
      const testTools = [
        "Read",
        "Glob",
        "Grep",
        "LSP",
        "WebFetch",
        "WebSearch",
        "Task",
        "TaskOutput",
        "Edit",
        "Write",
        "NotebookEdit",
        "Bash",
        "AskUserQuestion",
      ];

      for (const tool of testTools) {
        // Create fresh processes for each tool to avoid state pollution
        const defaultProcess = new Process(createMockIterator([]), {
          queue: new MessageQueue(),
          projectPath: "/test",
          sessionId: "sess-1",
          idleTimeoutMs: 100,
          permissionMode: "default",
        });

        const acceptEditsProcess = new Process(createMockIterator([]), {
          queue: new MessageQueue(),
          projectPath: "/test",
          sessionId: "sess-2",
          idleTimeoutMs: 100,
          permissionMode: "acceptEdits",
        });

        // Start both approval requests
        const defaultPromise = defaultProcess.handleToolApproval(
          tool,
          {},
          { signal: abortController.signal },
        );
        const acceptEditsPromise = acceptEditsProcess.handleToolApproval(
          tool,
          {},
          { signal: abortController.signal },
        );

        // Check immediate states (before any user response)
        const defaultNeedsApproval = defaultProcess.state.type === "waiting-input";
        const acceptEditsNeedsApproval = acceptEditsProcess.state.type === "waiting-input";

        // If default auto-approves, acceptEdits must also auto-approve
        if (!defaultNeedsApproval) {
          expect(acceptEditsNeedsApproval).toBe(false);
          // Both should return allow
          const [defaultResult, acceptEditsResult] = await Promise.all([
            defaultPromise,
            acceptEditsPromise,
          ]);
          expect(defaultResult.behavior).toBe("allow");
          expect(acceptEditsResult.behavior).toBe("allow");
        } else {
          // If default needs approval, acceptEdits might auto-approve (e.g., Edit)
          // but we need to resolve the pending promise for default
          const pendingRequest = pendingInput(defaultProcess);
          if (pendingRequest) {
            defaultProcess.respondToInput(pendingRequest.id, "approve");
          }

          // Also resolve acceptEdits if it's waiting
          if (acceptEditsNeedsApproval) {
            const acceptEditsPendingRequest = pendingInput(acceptEditsProcess);
            if (acceptEditsPendingRequest) {
              acceptEditsProcess.respondToInput(acceptEditsPendingRequest.id, "approve");
            }
          }

          await Promise.all([defaultPromise, acceptEditsPromise]);
        }
      }
    });

    it("handleToolApproval prompts user for mutating tools in default mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "default",
      });

      const abortController = new AbortController();

      // Edit should prompt the user in default mode
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      // Should be in waiting-input state (prompting user)
      expect(process.state.type).toBe("waiting-input");

      // Simulate user approving
      const pendingRequest = pendingInput(process);
      expect(pendingRequest).not.toBeNull();
      expect(pendingRequest?.toolName).toBe("Edit");
      if (pendingRequest) {
        process.respondToInput(pendingRequest.id, "approve");
      }

      const result = await approvalPromise;
      expect(result.behavior).toBe("allow");
    });

    it("handles concurrent tool approvals (queues them)", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "default",
      });

      const abortController = new AbortController();

      // Start two concurrent tool approvals for tools that require approval (Bash, not Read)
      const approval1 = process.handleToolApproval(
        "Bash",
        { command: "ls -la" },
        { signal: abortController.signal },
      );
      const approval2 = process.handleToolApproval(
        "Bash",
        { command: "pwd" },
        { signal: abortController.signal },
      );

      // Both should be pending - first one should be shown
      const firstRequest = pendingInput(process);
      expect(firstRequest).not.toBeNull();
      expect(firstRequest?.toolName).toBe("Bash");

      // Process should be in waiting-input state
      expect(process.state.type).toBe("waiting-input");

      // Approve the first request
      if (!firstRequest) throw new Error("firstRequest should not be null");
      const firstId = firstRequest.id;
      const responded1 = process.respondToInput(firstId, "approve");
      expect(responded1).toBe(true);

      // First approval should resolve
      const result1 = await approval1;
      expect(result1.behavior).toBe("allow");

      // Second request should now be pending
      const secondRequest = pendingInput(process);
      expect(secondRequest).not.toBeNull();
      expect(secondRequest?.id).not.toBe(firstId);

      // Approve the second request
      if (!secondRequest) throw new Error("secondRequest should not be null");
      const responded2 = process.respondToInput(secondRequest.id, "approve");
      expect(responded2).toBe(true);

      // Second approval should resolve
      const result2 = await approval2;
      expect(result2.behavior).toBe("allow");

      // No more pending requests
      expect(pendingInput(process)).toBeNull();
      expect(process.state.type).toBe("in-turn");
    });
  });

  describe("approval requests", () => {
    it("say which tool call they are about, so the UI can ask on its row", async () => {
      const process = new Process(
        createMockIterator([{ type: "session.started", sessionId: "sess-1" }]),
        {
          queue: new MessageQueue(),
          projectPath: "/test",
          sessionId: "sess-1",
          idleTimeoutMs: 100,
        },
      );
      const controller = new AbortController();
      void process.handleToolApproval(
        "Bash",
        { command: "rm -rf build" },
        {
          signal: controller.signal,
          toolUseID: "call-9",
        },
      );
      expect(pendingInput(process)).toMatchObject({
        toolName: "Bash",
        toolCallId: "call-9",
      });
      controller.abort();
    });
  });

  describe("queued user messages", () => {
    const newProcess = (queue: MessageQueue) =>
      new Process(createMockIterator([{ type: "session.started", sessionId: "sess-1" }]), {
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        queue,
      });

    it("records exactly what the provider receives, attachments included", async () => {
      const queue = new MessageQueue();
      const process = newProcess(queue);
      const dir = await mkdtemp(join(tmpdir(), "hub-queue-"));
      const screenshot = join(dir, "screenshot.png");
      await writeFile(screenshot, Buffer.from("png-bytes"));
      process.queueMessage({
        text: "Here is a screenshot",
        attachments: [
          {
            id: "file-1",
            originalName: "screenshot.png",
            size: 1024,
            mimeType: "image/png",
            path: screenshot,
          },
          {
            id: "file-2",
            originalName: "document.pdf",
            size: 2048576,
            mimeType: "application/pdf",
            path: "/uploads/document.pdf",
          },
        ],
      });

      const sent = await queue.generator().next();
      const content = sent.value?.message?.content as Array<{
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
      const process = newProcess(new MessageQueue());
      const agentEvents: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") agentEvents.push(event.event);
      });
      process.queueMessage({ text: "test message" });
      expect(agentEvents).toEqual([]);
    });
  });

  describe("process termination", () => {
    it("isTerminated returns false for new process", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.isTerminated).toBe(false);
      expect(process.terminationReason).toBe(null);
    });

    it("queueMessage returns error when process is terminated", async () => {
      // Create an iterator that throws a process termination error
      const error = new Error("ProcessTransport is not ready for writing");
      async function* failingIterator(): AsyncIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "sess-1" };
        throw error;
      }

      const process = new Process(failingIterator(), {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      // Wait for the iterator to process and fail
      await vi.waitFor(() => {
        expect(process.isTerminated).toBe(true);
      });

      // Now queueMessage should return an error
      const result = process.queueMessage({ text: "should fail" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("terminated");
    });

    it("emits terminated event when process dies", async () => {
      const error = new Error("ProcessTransport is not ready for writing");
      async function* failingIterator(): AsyncIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "sess-1" };
        throw error;
      }

      const process = new Process(failingIterator(), {
        queue: new MessageQueue(),
        projectPath: "/test",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      let terminatedEvent: { reason: string; error?: Error } | null = null;
      process.subscribe((event) => {
        if (event.type === "terminated") {
          terminatedEvent = { reason: event.reason, error: event.error };
        }
      });

      // Wait for the terminated event
      await vi.waitFor(() => {
        expect(terminatedEvent).not.toBe(null);
      });

      expect(terminatedEvent?.reason).toContain("terminated");
      expect(terminatedEvent?.error).toBe(error);
    });
  });
});
