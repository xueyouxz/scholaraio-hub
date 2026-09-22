import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { UIChunkWriter, appendReplayChunk } from "../../src/agent/uiChunks.js";

const preliminary = (id: string, content: string): UIMessageChunk => ({
  type: "tool-output-available",
  toolCallId: id,
  output: { content, isError: false },
  dynamic: true,
  preliminary: true,
});

describe("appendReplayChunk", () => {
  it("keeps only the latest running output per tool call", () => {
    const chunks: UIMessageChunk[] = [];
    appendReplayChunk(chunks, preliminary("a", "1"));
    appendReplayChunk(chunks, { type: "text-delta", id: "t", delta: "x" });
    appendReplayChunk(chunks, preliminary("b", "b1"));
    appendReplayChunk(chunks, preliminary("a", "12"));
    expect(chunks).toEqual([
      preliminary("a", "12"),
      { type: "text-delta", id: "t", delta: "x" },
      preliminary("b", "b1"),
    ]);
  });
});

describe("UIChunkWriter running output", () => {
  it("keeps the tail of very long running output", () => {
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    writer.write({ type: "tool.call", callId: "a", name: "Bash", input: {} });
    writer.write({ type: "tool.output.delta", callId: "a", delta: "x".repeat(40_000) });
    writer.write({ type: "tool.output.delta", callId: "a", delta: "END" });
    const last = chunks.at(-1) as { output: { content: string } };
    expect(last.output.content.startsWith("…")).toBe(true);
    expect(last.output.content.endsWith("END")).toBe(true);
    expect(last.output.content.length).toBeLessThanOrEqual(32 * 1024 + 1);
  });
});
