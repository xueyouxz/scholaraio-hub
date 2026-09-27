import type { UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIChunkWriter, appendReplayChunk } from "../../src/sessions/UIChunkWriter.js";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the tail of very long running output", async () => {
    vi.useFakeTimers();
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    writer.write({ type: "tool.call", callId: "a", name: "Bash", input: {} });
    writer.write({ type: "tool.output.delta", callId: "a", delta: "x".repeat(40_000) });
    writer.write({ type: "tool.output.delta", callId: "a", delta: "END" });
    await vi.advanceTimersByTimeAsync(300);
    const last = chunks.at(-1) as { output: { content: string } };
    expect(last.output.content.startsWith("…")).toBe(true);
    expect(last.output.content.endsWith("END")).toBe(true);
    expect(last.output.content.length).toBeLessThanOrEqual(32 * 1024 + 1);
  });

  it("sends a busy tool's preview at most every 250ms, and nothing after its result", async () => {
    vi.useFakeTimers();
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    const previews = () =>
      chunks.filter((chunk) => chunk.type === "tool-output-available" && chunk.preliminary);
    writer.write({ type: "tool.call", callId: "a", name: "Bash", input: {} });
    for (let line = 0; line < 100; line++)
      writer.write({ type: "tool.output.delta", callId: "a", delta: `line ${line}\n` });
    expect(previews()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(previews()).toHaveLength(2);
    expect(previews().at(-1)).toMatchObject({
      output: { content: expect.stringContaining("line 99") },
    });
    writer.write({ type: "tool.output.delta", callId: "a", delta: "late\n" });
    writer.write({ type: "tool.result", callId: "a", output: "done", isError: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(previews()).toHaveLength(2);
  });
});

describe("replay buffer", () => {
  it("joins deltas that continue one block, without changing the chunk sent live", () => {
    const chunks: UIMessageChunk[] = [];
    const first: UIMessageChunk = { type: "text-delta", id: "t", delta: "Hel" };
    appendReplayChunk(chunks, first);
    appendReplayChunk(chunks, { type: "text-delta", id: "t", delta: "lo" });
    appendReplayChunk(chunks, { type: "reasoning-delta", id: "r", delta: "a" });
    appendReplayChunk(chunks, { type: "text-delta", id: "t", delta: "!" });
    expect(chunks).toEqual([
      { type: "text-delta", id: "t", delta: "Hello" },
      { type: "reasoning-delta", id: "r", delta: "a" },
      { type: "text-delta", id: "t", delta: "!" },
    ]);
    expect(first.delta).toBe("Hel");
  });
});
