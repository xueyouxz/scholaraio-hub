import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  messages: [] as Array<{ type: string; uuid: string; message: unknown }>,
  forks: [] as Array<{ sessionId: string; options: unknown }>,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionMessages: async () => sdk.messages,
  forkSession: async (sessionId: string, options: unknown) => {
    sdk.forks.push({ sessionId, options });
    return { sessionId: "forked" };
  },
}));

const { ClaudeProvider } = await import("../../../src/providers/claude/ClaudeProvider.js");

const prompt = (uuid: string, text: string) => ({
  type: "user",
  uuid,
  message: { role: "user", content: text },
});
const reply = (uuid: string) => ({
  type: "assistant",
  uuid,
  message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
});
const toolResult = (uuid: string) => ({
  type: "user",
  uuid,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] },
});

describe("ClaudeProvider.forkSession", () => {
  beforeEach(() => {
    sdk.forks = [];
    sdk.messages = [
      prompt("p1", "first"),
      reply("a1"),
      toolResult("r1"),
      reply("a2"),
      prompt("i1", "[Request interrupted by user]"),
      prompt("p2", "second"),
      reply("a3"),
      prompt("p3", "third"),
      reply("a4"),
    ];
  });

  it("cuts before the first dropped prompt, skipping tool results and markers", async () => {
    const provider = new ClaudeProvider();
    await expect(provider.forkSession({ sessionId: "s", cwd: "/w", dropTurns: 2 })).resolves.toBe(
      "forked",
    );
    expect(sdk.forks[0]).toEqual({
      sessionId: "s",
      options: { dir: "/w", upToMessageId: "i1" },
    });
  });

  it("copies everything when nothing is dropped", async () => {
    await new ClaudeProvider().forkSession({ sessionId: "s", cwd: "/w", dropTurns: 0 });
    expect(sdk.forks[0]?.options).toEqual({ dir: "/w", upToMessageId: undefined });
  });

  it("refuses a cut the transcript cannot place", async () => {
    await expect(
      new ClaudeProvider().forkSession({ sessionId: "s", cwd: "/w", dropTurns: 3 }),
    ).rejects.toThrow();
    expect(sdk.forks).toEqual([]);
  });
});
