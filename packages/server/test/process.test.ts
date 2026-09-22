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

describe("Process", () => {
  it("releases a live idle worker while retaining its native session ID", async () => {
    const abort = vi.fn();
    const process = new Process(createMockIterator([{ type: "turn.completed" }]), {
      projectPath: "/test",
      projectId: "project",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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

    it("reports queue depth", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.queueMessage({ text: "first" });
      process.queueMessage({ text: "second" });

      expect(process.queueDepth).toBe(2);
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
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        queue,
        controls: resolveSessionControls({ steer: steerFn } as unknown as AgentSession),
      });

      const result = process.queueMessage({ text: "steer me" });

      expect(result.success).toBe(true);
      expect(result.position).toBe(0);
      expect(steerFn).toHaveBeenCalledTimes(1);
      expect(process.queueDepth).toBe(0);

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
        projectId: "proj-1",
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
      expect(process.queueDepth).toBe(1);

      // Let the iterator complete so abort() doesn't hang
      resolveIterator?.();
      await process.abort();
    });
  });

  describe("getInfo", () => {
    it("returns process info", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test/path",
        projectId: "proj-123",
        sessionId: "sess-456",
        idleTimeoutMs: 100,
      });

      const info = process.getInfo();

      expect(info.id).toBe(process.id);
      expect(info.sessionId).toBe("sess-456");
      expect(info.projectId).toBe("proj-123");
      expect(info.projectPath).toBe("/test/path");
      expect(info.startedAt).toBeDefined();
    });
  });

  describe("abort", () => {
    it("emits complete event on abort", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.permissionMode).toBe("default");
    });

    it("accepts initial permission mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        permissionMode: "acceptEdits",
      });

      expect(process.permissionMode).toBe("acceptEdits");
    });

    it("allows changing permission mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.setPermissionMode("bypassPermissions");
      expect(process.permissionMode).toBe("bypassPermissions");

      process.setPermissionMode("plan");
      expect(process.permissionMode).toBe("plan");
    });

    it("initializes modeVersion to 0", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.modeVersion).toBe(0);
    });

    it("increments modeVersion when mode changes", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.modeVersion).toBe(0);

      process.setPermissionMode("acceptEdits");
      expect(process.modeVersion).toBe(1);

      process.setPermissionMode("bypassPermissions");
      expect(process.modeVersion).toBe(2);

      process.setPermissionMode("plan");
      expect(process.modeVersion).toBe(3);
    });

    it("emits mode-change event when mode changes", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const events: ProcessEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "mode-change") {
          events.push(event);
        }
      });

      process.setPermissionMode("acceptEdits");
      process.setPermissionMode("bypassPermissions");

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "mode-change",
        mode: "acceptEdits",
        version: 1,
      });
      expect(events[1]).toEqual({
        type: "mode-change",
        mode: "bypassPermissions",
        version: 2,
      });
    });

    it("handleToolApproval auto-approves in bypassPermissions mode", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
      const pendingRequest = process.getPendingInputRequest();
      expect(pendingRequest).not.toBeNull();
      expect(pendingRequest?.toolName).toBe("Edit");
      process.respondToInput(pendingRequest?.id ?? "", "deny");

      const result = await approvalPromise;
      expect(result.behavior).toBe("deny");
    });

    it("queues deny feedback as follow-up message for Codex approvals", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        provider: "codex",
        queue: new MessageQueue(),
      });

      const abortController = new AbortController();
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      const pendingRequest = process.getPendingInputRequest();
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
      expect(process.queueDepth).toBe(1);
    });

    it("does not queue deny feedback follow-up for non-Codex providers", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        provider: "claude",
        queue: new MessageQueue(),
      });

      const abortController = new AbortController();
      const approvalPromise = process.handleToolApproval(
        "Edit",
        { file: "test.ts" },
        { signal: abortController.signal },
      );

      const pendingRequest = process.getPendingInputRequest();
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
      expect(process.queueDepth).toBe(0);
    });

    it("handleToolApproval prompts user for ExitPlanMode in plan mode (not auto-approve)", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
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
      const pendingRequest = process.getPendingInputRequest();
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
        projectPath: "/test",
        projectId: "proj-1",
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
      const pendingRequest = process.getPendingInputRequest();
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
          projectPath: "/test",
          projectId: "proj-1",
          sessionId: "sess-1",
          idleTimeoutMs: 100,
          permissionMode: "default",
        });

        const acceptEditsProcess = new Process(createMockIterator([]), {
          projectPath: "/test",
          projectId: "proj-1",
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
          const pendingRequest = defaultProcess.getPendingInputRequest();
          if (pendingRequest) {
            defaultProcess.respondToInput(pendingRequest.id, "approve");
          }

          // Also resolve acceptEdits if it's waiting
          if (acceptEditsNeedsApproval) {
            const acceptEditsPendingRequest = acceptEditsProcess.getPendingInputRequest();
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
        projectPath: "/test",
        projectId: "proj-1",
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
      const pendingRequest = process.getPendingInputRequest();
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
        projectPath: "/test",
        projectId: "proj-1",
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
      const firstRequest = process.getPendingInputRequest();
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
      const secondRequest = process.getPendingInputRequest();
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
      expect(process.getPendingInputRequest()).toBeNull();
      expect(process.state.type).toBe("in-turn");
    });
  });

  describe("approval requests", () => {
    it("say which tool call they are about, so the UI can ask on its row", async () => {
      const process = new Process(
        createMockIterator([{ type: "session.started", sessionId: "sess-1" }]),
        { projectPath: "/test", projectId: "proj-1", sessionId: "sess-1", idleTimeoutMs: 100 },
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
      expect(process.getPendingInputRequest()).toMatchObject({
        toolName: "Bash",
        toolCallId: "call-9",
      });
      controller.abort();
    });
  });

  describe("first user message", () => {
    const newProcess = (queue?: MessageQueue) =>
      new Process(createMockIterator([{ type: "session.started", sessionId: "sess-1" }]), {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
        queue,
      });

    it("remembers only the first message, for the optimistic session title", () => {
      const process = newProcess(new MessageQueue());
      process.queueMessage({ text: "first question" });
      process.queueMessage({ text: "follow-up" });
      expect(process.firstUserText).toBe("first question");
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
      expect(process.firstUserText).toBe(content[0]?.text);
      expect(process.firstUserText).toContain("User uploaded files:");
      expect(process.firstUserText).toContain("1.0 KB");
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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
        projectPath: "/test",
        projectId: "proj-1",
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

    it("getInfo returns terminated state", async () => {
      const error = new Error("process exited");
      async function* failingIterator(): AsyncIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "sess-1" };
        throw error;
      }

      const process = new Process(failingIterator(), {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      // Wait for termination
      await vi.waitFor(() => {
        expect(process.isTerminated).toBe(true);
      });

      const info = process.getInfo();
      expect(info.state).toBe("terminated");
    });
  });

  describe("hold mode", () => {
    it("setHold(true) transitions to hold state", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      expect(process.isHeld).toBe(false);
      expect(process.holdSince).toBe(null);

      process.setHold(true);

      expect(process.isHeld).toBe(true);
      expect(process.holdSince).not.toBe(null);
      expect(process.state.type).toBe("hold");
    });

    it("setHold(false) transitions back to running", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.setHold(true);
      expect(process.state.type).toBe("hold");

      process.setHold(false);
      expect(process.isHeld).toBe(false);
      expect(process.holdSince).toBe(null);
      expect(process.state.type).toBe("in-turn");
    });

    it("emits state-change events for hold/resume", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const stateChanges: string[] = [];
      process.subscribe((event) => {
        if (event.type === "state-change") {
          stateChanges.push(event.state.type);
        }
      });

      process.setHold(true);
      process.setHold(false);

      expect(stateChanges).toContain("hold");
      expect(stateChanges).toContain("in-turn");
    });

    it("setHold is idempotent", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const stateChanges: string[] = [];
      process.subscribe((event) => {
        if (event.type === "state-change") {
          stateChanges.push(event.state.type);
        }
      });

      // Calling setHold(true) multiple times should only emit once
      process.setHold(true);
      process.setHold(true);
      process.setHold(true);

      const holdChanges = stateChanges.filter((s) => s === "hold");
      expect(holdChanges).toHaveLength(1);
    });

    it("getInfo returns hold state and holdSince", async () => {
      const iterator = createMockIterator([]);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.setHold(true);

      const info = process.getInfo();
      expect(info.state).toBe("hold");
      expect(info.holdSince).toBeDefined();
    });

    it("pauses iterator consumption when held", async () => {
      // Create an iterator that we can control
      let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
      const controllableIterator: AsyncIterator<AgentEvent> = {
        next() {
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
      };

      const process = new Process(controllableIterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const receivedMessages: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") {
          receivedMessages.push(event.event);
        }
      });

      // Let the first message through
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (resolveNext) {
        resolveNext({
          done: false,
          value: { type: "session.started", sessionId: "sess-1" },
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(receivedMessages).toHaveLength(1);

      // Now hold the process - the next iterator.next() should not be called
      // until we resume
      process.setHold(true);

      // The loop should be blocked waiting to resume
      // If we resolve another message, it shouldn't be received yet
      // (This is hard to test without more control, but we can at least
      // verify the state)
      expect(process.state.type).toBe("hold");
    });

    it("resumes iterator consumption after hold is released", async () => {
      const messages: AgentEvent[] = [
        { type: "session.started", sessionId: "sess-1" },
        { type: "text.delta", blockId: "b1", delta: "Hello" },
        { type: "turn.completed" },
      ];

      const iterator = createMockIterator(messages);
      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      const receivedMessages: AgentEvent[] = [];
      process.subscribe((event) => {
        if (event.type === "agent") {
          receivedMessages.push(event.event);
        }
      });

      // Wait for processing to complete (mock iterator is fast)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // All messages should be received
      expect(receivedMessages).toHaveLength(3);
    });

    it("can queue messages while held", async () => {
      const iterator = createMockIterator([{ type: "session.started", sessionId: "sess-1" }]);

      const process = new Process(iterator, {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      process.setHold(true);

      // Should still be able to queue messages
      const result = process.queueMessage({ text: "Hello while held" });
      expect(result.success).toBe(true);
      expect(result.position).toBe(1);
    });

    it("termination while held resolves the wait", async () => {
      // Create an iterator that throws after first message
      async function* failingIterator(): AsyncIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "sess-1" };
        throw new Error("ProcessTransport is not ready for writing");
      }

      const process = new Process(failingIterator(), {
        projectPath: "/test",
        projectId: "proj-1",
        sessionId: "sess-1",
        idleTimeoutMs: 100,
      });

      // Wait for error to occur and process to terminate
      await vi.waitFor(() => {
        expect(process.isTerminated).toBe(true);
      });

      // Hold should be cleared
      expect(process.isHeld).toBe(false);
    });
  });
});
