import { randomUUID } from "node:crypto";
import type { ModelInfo, SlashCommand } from "@scholaraio-hub/shared";
import { MessageQueue } from "../../src/providers/MessageQueue.js";
import { ClaudeEventAdapter } from "../../src/providers/claude/ClaudeEventAdapter.js";
import { claudePrompt } from "../../src/providers/claude/ClaudeSession.js";
import type { SDKMessage } from "../../src/providers/claude/sdk-message.js";
import type { AgentEvent } from "../../src/providers/events.js";
import type {
  AgentProvider,
  ForkSessionOptions,
  StartSessionOptions,
} from "../../src/providers/types.js";
import { TEST_CAPABILITIES } from "./scriptedProvider.js";

/**
 * A reply that exercises the transcript renderer: a table, math, markup that must
 * not execute, a long body, an unterminated code fence and an Edit with its result.
 * Sent back whole, as a provider does when it does not stream.
 */
const RENDER_SAMPLE_PROMPT = "render sample";
const RENDER_SAMPLE_TEXT = [
  "# 历史阅读测试",
  "",
  "| 项目 | 数值 |",
  "| --- | --- |",
  "| 样本 | 42 |",
  "",
  "$E=mc^2$",
  "",
  '<script>window.__unsafeExecuted=true</script><img src=x onerror="window.__unsafeExecuted=true">',
  "[危险链接](javascript:alert(1))",
  "",
  ...Array.from({ length: 50 }, (_, index) => `中文长消息段落 ${index}，用于检查内容保留。`),
  "",
  "```typescript",
  'const result = "未闭合代码块";',
].join("\n");

/** The fake speaks Agent SDK wire format; translate it as the real provider does. */
async function* replayThroughAdapter(
  messages: AsyncIterable<SDKMessage>,
): AsyncIterableIterator<AgentEvent> {
  const adapter = new ClaudeEventAdapter();
  for await (const message of messages) yield* adapter.accept(message);
}

/** Deterministic CLI boundary for protocol and browser tests. */
export class WorkbenchProvider implements AgentProvider {
  readonly displayName = "Test provider";
  readonly capabilities = TEST_CAPABILITIES;
  readonly calls: StartSessionOptions[] = [];
  readonly inputs: string[] = [];
  interruptions = 0;
  approvals: string[] = [];
  /** What `getAvailableModels` reports; empty means the CLI listed nothing. */
  models: ModelInfo[] = [];
  constructor(readonly name: "claude" | "codex" = "claude") {}
  async getAuthStatus() {
    return { installed: true, authenticated: true, enabled: true };
  }
  async getAvailableModels() {
    return this.models;
  }
  /** What `listCommands` reports; the cwds it was asked about are recorded. */
  commands: SlashCommand[] = [];
  readonly commandCwds: string[] = [];
  async listCommands(cwd: string) {
    this.commandCwds.push(cwd);
    return this.commands;
  }
  /** Native forks asked for; each returns a new native id. */
  readonly forks: Array<ForkSessionOptions & { forkedId: string }> = [];
  async forkSession(options: ForkSessionOptions) {
    const forkedId = `fork-${randomUUID()}`;
    this.forks.push({ ...options, forkedId });
    return forkedId;
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
      for await (const item of claudePrompt(queue)) {
        if (abort.signal.aborted) return;
        const text =
          typeof item.message.content === "string"
            ? item.message.content
            : JSON.stringify(item.message.content);
        owner.inputs.push(text);
        const nativeId = randomUUID();
        if (text.includes(RENDER_SAMPLE_PROMPT)) {
          yield {
            type: "assistant",
            message: {
              id: nativeId,
              content: [
                { type: "text", text: RENDER_SAMPLE_TEXT },
                {
                  type: "tool_use",
                  id: "edit",
                  name: "Edit",
                  input: { file_path: "result.txt", old_string: "before\n", new_string: "after\n" },
                },
              ],
            },
          };
          yield {
            type: "user",
            message: { content: [{ type: "tool_result", tool_use_id: "edit", content: "Edited" }] },
          };
          yield { type: "result", subtype: "success", session_id: sessionId };
          continue;
        }
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
      events: replayThroughAdapter(events()),
      queue,
      abort: () => {
        abort.abort();
        release?.();
        queue.close();
      },
      interrupt: async () => {
        owner.interruptions++;
        release?.();
      },
    };
  }
}
