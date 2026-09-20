import { randomUUID } from "node:crypto";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type { AgentProvider, StartSessionOptions } from "../../src/sdk/providers/types.js";
import type { SDKMessage } from "../../src/sdk/types.js";

/** Deterministic CLI boundary for protocol and browser tests. */
export class WorkbenchProvider implements AgentProvider {
  readonly displayName = "Test provider";
  readonly supportsPermissionMode = true;
  readonly supportsThinkingToggle = false;
  readonly supportsSlashCommands = false;
  readonly calls: StartSessionOptions[] = [];
  readonly inputs: string[] = [];
  interruptions = 0;
  approvals: string[] = [];
  constructor(readonly name: "claude" | "codex" = "claude") {}
  async isInstalled() {
    return true;
  }
  async isAuthenticated() {
    return true;
  }
  async getAuthStatus() {
    return { installed: true, authenticated: true, enabled: true };
  }
  async getAvailableModels() {
    return [];
  }
  async startSession(options: StartSessionOptions) {
    this.calls.push(options);
    const sessionId = options.resumeSessionId ?? randomUUID();
    const queue = new MessageQueue();
    if (options.initialMessage) queue.push(options.initialMessage);
    const owner = this;
    const abort = new AbortController();
    let release: (() => void) | undefined;
    async function* events(): AsyncGenerator<SDKMessage> {
      yield { type: "system", subtype: "init", session_id: sessionId };
      for await (const item of queue.generator()) {
        if (abort.signal.aborted) return;
        const text =
          typeof item.message.content === "string"
            ? item.message.content
            : JSON.stringify(item.message.content);
        owner.inputs.push(text);
        const nativeId = randomUUID();
        yield { type: "stream_event", event: { type: "message_start", message: { id: nativeId } } };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
        };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "文献回答 " },
          },
        };
        if (text.includes("approval")) {
          const decision = await options.onToolApproval?.(
            "Write",
            { file_path: "result.txt", content: "test" },
            { signal: abort.signal },
          );
          owner.approvals.push(decision?.behavior ?? "missing");
        }
        if (text.includes("slow"))
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (abort.signal.aborted) return;
        yield {
          type: "assistant",
          message: { id: nativeId, content: [{ type: "text", text: "文献回答 [ref-1]" }] },
        };
        yield { type: "result", subtype: "success", session_id: sessionId };
      }
    }
    return {
      iterator: events(),
      queue,
      sessionId,
      abort: () => {
        abort.abort();
        release?.();
        queue.push({ text: "" });
      },
      interrupt: async () => {
        owner.interruptions++;
        release?.();
      },
    };
  }
}
