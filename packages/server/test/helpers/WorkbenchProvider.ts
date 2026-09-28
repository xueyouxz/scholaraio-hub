import { randomUUID } from "node:crypto";
import type { ModelInfo, SlashCommand } from "@scholaraio-hub/shared";
import { MessageQueue } from "../../src/providers/MessageQueue.js";
import { ClaudeEventAdapter } from "../../src/providers/claude/ClaudeEventAdapter.js";
import { claudePrompt } from "../../src/providers/claude/ClaudeSession.js";
import { type TranscriptMessage, claudeTurns } from "../../src/providers/claude/history.js";
import type { SDKMessage } from "../../src/providers/claude/sdk-message.js";
import type { AgentEvent } from "../../src/providers/events.js";
import type {
  AgentProvider,
  ForkSessionOptions,
  NativeRewind,
  NativeSession,
  NativeTurn,
  ReadSessionOptions,
  StartSessionOptions,
  UserMessage,
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
  /** Every message the sessions were handed, first ones and later ones alike. */
  readonly messages: UserMessage[] = [];
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
  /** Sessions a test put in the provider's history, besides those this fake ran. */
  stored: NativeSession[] = [];
  transcripts = new Map<string, NativeTurn[]>();
  /** Sessions this fake ran, kept the way Claude Code keeps them: a transcript per session. */
  readonly kept = new Map<string, { session: NativeSession; messages: TranscriptMessage[] }>();
  async listSessions() {
    return [...this.stored, ...[...this.kept.values()].map(({ session }) => session)];
  }
  async readSession(id: string, { resumeAt }: ReadSessionOptions) {
    const kept = this.kept.get(id);
    if (!kept) return this.transcripts.get(id) ?? [];
    return claudeTurns(upTo(kept.messages, resumeAt));
  }
  private keep(id: string, cwd: string, message: TranscriptMessage) {
    const now = new Date().toISOString();
    let kept = this.kept.get(id);
    if (!kept) {
      kept = { session: { id, cwd, title: "", createdAt: now, updatedAt: now }, messages: [] };
      this.kept.set(id, kept);
    }
    kept.messages.push(message);
    kept.session.updatedAt = now;
    if (!kept.session.title && message.type === "user" && typeof message.message === "object")
      kept.session.title = String((message.message as { content?: unknown }).content ?? "").slice(
        0,
        60,
      );
  }

  readonly forks: Array<ForkSessionOptions & { forkedId: string }> = [];
  async forkSession(options: ForkSessionOptions) {
    const forkedId = randomUUID();
    this.forks.push({ ...options, forkedId });
    const source = this.kept.get(options.sessionId);
    if (source) {
      const prompts = source.messages.flatMap((message, index) =>
        message.type === "user" &&
        typeof (message.message as { content?: unknown }).content === "string"
          ? [index]
          : [],
      );
      const cut = options.dropTurns ? prompts[prompts.length - options.dropTurns] : undefined;
      this.kept.set(forkedId, {
        session: { ...source.session, id: forkedId },
        messages: source.messages.slice(0, cut),
      });
    }
    return forkedId;
  }
  /** In-place rewinds asked for; each resumes the same session at its last reply before the cut. */
  readonly rewinds: Array<ForkSessionOptions & { resumeAt: string }> = [];
  async rewindSession(options: ForkSessionOptions): Promise<NativeRewind> {
    const messages = upTo(this.kept.get(options.sessionId)?.messages ?? [], options.resumeAt);
    const prompts = messages.flatMap((message, index) =>
      message.type === "user" &&
      typeof (message.message as { content?: unknown }).content === "string"
        ? [index]
        : [],
    );
    const cut = prompts[prompts.length - options.dropTurns] ?? 0;
    const resumeAt =
      messages
        .slice(0, cut)
        .filter((message) => message.type === "assistant")
        .at(-1)?.uuid ?? `cut-${this.rewinds.length + 1}`;
    this.rewinds.push({ ...options, resumeAt });
    return { sessionId: options.sessionId, resumeAt };
  }
  async startSession(options: StartSessionOptions) {
    this.calls.push(options);
    const sessionId = options.resumeSessionId ?? randomUUID();
    // Resuming at a rewind's point drops what came after it, as Claude Code does.
    const resumed = this.kept.get(sessionId);
    if (resumed && options.resumeAt) resumed.messages = upTo(resumed.messages, options.resumeAt);
    const keep = (message: TranscriptMessage) => this.keep(sessionId, options.cwd, message);
    const queue = new MessageQueue();
    const push = queue.push.bind(queue);
    queue.push = (message: UserMessage) => {
      this.messages.push(message);
      return push(message);
    };
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
        keep({
          type: "user",
          uuid: item.uuid ?? randomUUID(),
          message: { role: "user", content: text },
        });
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
    /** What the CLI would write to its transcript as the turn goes. */
    async function* recorded(messages: AsyncGenerator<SDKMessage>): AsyncGenerator<SDKMessage> {
      for await (const message of messages) {
        if (message.type === "assistant" || message.type === "user")
          keep({ type: message.type, uuid: randomUUID(), message: message.message });
        yield message;
      }
    }
    return {
      events: replayThroughAdapter(recorded(events())),
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

/** A transcript up to a rewind's resume point, as Claude Code resumes it. */
function upTo(messages: TranscriptMessage[], resumeAt: string | undefined): TranscriptMessage[] {
  if (!resumeAt) return messages;
  const end = messages.findIndex((message) => message.uuid === resumeAt);
  return end < 0 ? messages : messages.slice(0, end + 1);
}
