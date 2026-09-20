import type { SessionMessage } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import { describe, expect, it } from "vitest";
import type { SDKMessage } from "../../src/sdk/types.js";
import { SessionMessageNormalizer } from "../../src/sessions/SessionMessageNormalizer.js";
import { importHistory } from "../../src/sessions/import-history.js";

async function normalize(events: SDKMessage[]) {
  const chunks: UIMessageChunk[] = [{ type: "start", messageId: "stable" }];
  const normalizer = new SessionMessageNormalizer((chunk) => chunks.push(chunk));
  for (const event of events) normalizer.accept(event);
  normalizer.finish();
  normalizer.finish();
  chunks.push({ type: "finish" });
  let result: SessionMessage | undefined;
  for await (const message of readUIMessageStream<SessionMessage>({
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    terminateOnError: true,
  }))
    result = message;
  return { result, chunks };
}
const stream = (event: Record<string, unknown>): SDKMessage => ({ type: "stream_event", event });

describe("application message protocol", () => {
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
      output: "资料",
    });
    expect(chunks.filter((chunk) => chunk.type === "text-end")).toHaveLength(2);
  });
  it("combines Codex deltas and completed item snapshots once", async () => {
    const { result } = await normalize([
      { type: "text_delta", uuid: "item-turn", delta: "Hello " },
      { type: "text_delta", uuid: "item-turn", delta: "world" },
      { type: "assistant", uuid: "item-turn", message: { content: "Hello world!" } },
      { type: "assistant", uuid: "item-turn", message: { content: "Hello world!" } },
    ]);
    expect(result?.parts).toMatchObject([{ type: "text", text: "Hello world!" }]);
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
  it("imports explicitly selected Claude history without native IDs", async () => {
    const messages = await importHistory(
      [
        { type: "user", uuid: "native-user", message: { content: "问题" } },
        {
          type: "assistant",
          message: { id: "native-assistant", content: [{ type: "text", text: "回答" }] },
        },
      ]
        .map((item) => JSON.stringify(item))
        .join("\n"),
      "claude",
    );
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.id).not.toBe("native-user");
    await expect(importHistory("broken", "claude")).rejects.toThrow("第 1 行");
  });
});
