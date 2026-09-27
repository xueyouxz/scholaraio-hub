import { type SessionMessage, parentCallIdOf } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import { describe, expect, it } from "vitest";
import { ClaudeEventAdapter } from "../../../src/providers/claude/ClaudeEventAdapter.js";
import type { SDKMessage } from "../../../src/providers/claude/sdk-message.js";
import { CodexEventAdapter } from "../../../src/providers/codex/CodexEventAdapter.js";
import { UIChunkWriter } from "../../../src/sessions/UIChunkWriter.js";

async function assemble(chunks: UIMessageChunk[]) {
  let result: SessionMessage | undefined;
  for await (const message of readUIMessageStream<SessionMessage>({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "start", messageId: "stable" });
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    }),
    terminateOnError: true,
  }))
    result = message;
  return result;
}

/** Claude SDK messages -> AgentEvent -> UI chunks -> assembled message. */
async function normalize(messages: SDKMessage[]) {
  const adapter = new ClaudeEventAdapter();
  const chunks: UIMessageChunk[] = [];
  const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
  for (const message of messages) for (const event of adapter.accept(message)) writer.write(event);
  writer.close();
  writer.close();
  return { result: await assemble(chunks), chunks };
}
const stream = (event: Record<string, unknown>): SDKMessage => ({ type: "stream_event", event });

describe("Claude events to UI chunks", () => {
  it("deduplicates Claude final snapshots and preserves interleaved tools/reasoning", async () => {
    const events: SDKMessage[] = [
      stream({ type: "message_start", message: { id: "m1" } }),
      stream({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "推理" },
      }),
      stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      stream({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "第一段" },
      }),
      stream({
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool1", name: "Read" },
      }),
      stream({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"path":"paper"}' },
      }),
      stream({ type: "content_block_stop", index: 2 }),
      {
        type: "assistant",
        message: {
          id: "m1",
          content: [
            { type: "thinking", thinking: "推理" },
            { type: "text", text: "第一段" },
            { type: "tool_use", id: "tool1", name: "Read", input: { path: "paper" } },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool1", content: "资料" }] },
      },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "第二段" }] } },
    ];
    const { result, chunks } = await normalize([...events, ...events.slice(7, 9)]);
    expect(result?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
      "dynamic-tool",
      "text",
    ]);
    expect(result?.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
      "第一段",
      "第二段",
    ]);
    expect(result?.parts.find((part) => part.type === "dynamic-tool")).toMatchObject({
      state: "output-available",
      output: { content: "资料", isError: false },
    });
    expect(chunks.filter((chunk) => chunk.type === "text-end")).toHaveLength(2);
  });
  it("keeps block identity when Claude Code splits a message into one block per message", async () => {
    const block = (content: Record<string, unknown>): SDKMessage => ({
      type: "assistant",
      message: { id: "m1", content: [content] },
    });
    const events: SDKMessage[] = [
      stream({ type: "message_start", message: { id: "m1" } }),
      stream({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      stream({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Hello" },
      }),
      stream({
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool1", name: "Read" },
      }),
      stream({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"path":"a"}' },
      }),
      stream({ type: "content_block_stop", index: 2 }),
      block({ type: "thinking", thinking: "" }),
      block({ type: "text", text: "Hello" }),
      block({ type: "tool_use", id: "tool1", name: "Read", input: { path: "a" } }),
    ];
    const { result } = await normalize([...events, events[7] as SDKMessage]);
    expect(result?.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
      "Hello",
    ]);
    expect(result?.parts.filter((part) => part.type === "dynamic-tool")).toHaveLength(1);
  });
  it("shows retries, compaction and local command output as notices", () => {
    const adapter = new ClaudeEventAdapter();
    const events = [
      {
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 4000,
        error_status: 529,
        error: "server_error",
        uuid: "r1",
      },
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 1000 },
        uuid: "c1",
      },
      { type: "system", subtype: "local_command_output", content: "Total cost: $0.10", uuid: "l1" },
    ].flatMap((message) => adapter.accept(message));
    expect(events).toEqual([
      {
        type: "notice",
        key: "api-retry",
        level: "info",
        text: "The API request failed (529); retry 2/10 in 4s.",
      },
      { type: "notice", key: "c1", level: "info", text: "Context compacted automatically." },
      { type: "notice", key: "l1", level: "info", text: "Total cost: $0.10" },
    ]);
  });
  it("ends the turn with a failed API call's explanation instead of showing it as the answer", () => {
    const adapter = new ClaudeEventAdapter();
    const failure = adapter.accept({
      type: "assistant",
      error: "authentication_failed",
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "Invalid API key · Please run /login" }],
      },
    });
    expect(failure).toEqual([]);
    const [completed] = adapter.accept({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Invalid API key · Please run /login",
    });
    expect(completed).toMatchObject({ type: "turn.completed" });
    const error = completed?.type === "turn.completed" ? completed.error : undefined;
    expect(error).toContain("claude auth login");
    expect(error).toContain("Invalid API key");
  });
  it("reports a failed run by its errors, or in words for its subtype", () => {
    const adapter = new ClaudeEventAdapter();
    expect(
      adapter.accept({ type: "result", subtype: "error_during_execution", errors: ["a", "b"] }),
    ).toMatchObject([{ type: "turn.completed", error: "a\nb" }]);
    expect(
      adapter.accept({ type: "result", subtype: "error_max_turns", errors: [] }),
    ).toMatchObject([
      { type: "turn.completed", error: "The run stopped: it reached the maximum number of turns." },
    ]);
  });
  it("combines Codex deltas and completed item snapshots once", async () => {
    const adapter = new CodexEventAdapter("thread");
    adapter.beginTurn("turn");
    const item = (method: string, text: string) =>
      adapter.notification({
        method,
        params: {
          threadId: "thread",
          turnId: "turn",
          item: { id: "item", type: "agentMessage", text },
        },
      });
    const delta = (text: string) =>
      adapter.notification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread", turnId: "turn", itemId: "item", delta: text },
      });
    const events = [
      ...item("item/started", ""),
      ...delta("Hello "),
      ...delta("world"),
      ...item("item/completed", "Hello world!"),
      ...item("item/completed", "Hello world!"),
    ];
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    for (const event of events) writer.write(event);
    writer.close();
    expect((await assemble(chunks))?.parts).toMatchObject([{ type: "text", text: "Hello world!" }]);
  });
  it("shows a tool call while its arguments are still being written", async () => {
    const adapter = new ClaudeEventAdapter();
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    const feed = (message: SDKMessage) => {
      for (const event of adapter.accept(message)) writer.write(event);
    };
    feed(stream({ type: "message_start", message: { id: "m1" } }));
    feed(
      stream({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "w1", name: "Write" },
      }),
    );
    const announced = await assemble([...chunks]);
    expect(announced?.parts).toMatchObject([
      { type: "dynamic-tool", toolCallId: "w1", toolName: "Write", state: "input-streaming" },
    ]);

    feed(
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"file_path":"notes.md","content":"hel' },
      }),
    );
    const partial = await assemble([...chunks]);
    expect(partial?.parts[0]).toMatchObject({
      state: "input-streaming",
      input: { file_path: "notes.md", content: "hel" },
    });

    feed(
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'lo"}' },
      }),
    );
    feed(stream({ type: "content_block_stop", index: 0 }));
    feed({
      type: "assistant",
      message: {
        id: "m1",
        content: [
          {
            type: "tool_use",
            id: "w1",
            name: "Write",
            input: { file_path: "notes.md", content: "hello" },
          },
        ],
      },
    });
    writer.close();
    const final = await assemble(chunks);
    expect(final?.parts).toMatchObject([
      { state: "input-available", input: { file_path: "notes.md", content: "hello" } },
    ]);
    expect(chunks.filter((chunk) => chunk.type === "tool-input-start")).toHaveLength(1);
  });

  it("keeps subagent work, tagged with the Task call that started it", async () => {
    const sub = (message: SDKMessage): SDKMessage => ({ ...message, parent_tool_use_id: "task-1" });
    const { result } = await normalize([
      {
        type: "assistant",
        message: {
          id: "m1",
          content: [
            { type: "tool_use", id: "task-1", name: "Task", input: { description: "查资料" } },
          ],
        },
      },
      sub(stream({ type: "message_start", message: { id: "s1" } })),
      sub(
        stream({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
      ),
      sub(
        stream({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "子任务" },
        }),
      ),
      sub({
        type: "assistant",
        message: {
          id: "s1",
          content: [
            { type: "text", text: "子任务" },
            { type: "tool_use", id: "grep-1", name: "Grep", input: { pattern: "x" } },
          ],
        },
      }),
      sub({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "grep-1", content: "a.ts" }] },
      }),
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "结论" }] },
      },
    ]);
    const parts = result?.parts ?? [];
    expect(parts.map((part) => [part.type, parentCallIdOf(part)])).toEqual([
      ["dynamic-tool", undefined],
      ["text", "task-1"],
      ["dynamic-tool", "task-1"],
    ]);
    expect(parts[0]).toMatchObject({ toolCallId: "task-1", output: { content: "结论" } });
    expect(parts[2]).toMatchObject({ toolCallId: "grep-1", output: { content: "a.ts" } });
  });

  it("keeps supported file output once without exposing native filesystem paths", async () => {
    const message: SDKMessage = {
      type: "assistant",
      message: {
        id: "files",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
          {
            type: "document",
            source: { media_type: "application/pdf", url: "file:///private/file.pdf" },
          },
        ],
      },
    };
    const { result } = await normalize([message, message]);
    expect(result?.parts).toEqual([
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,aW1hZ2U=" },
    ]);
  });
});
