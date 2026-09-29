import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  sessions: [] as unknown[],
  messages: [] as unknown[],
  asked: [] as unknown[],
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listSessions: async () => sdk.sessions,
  getSessionMessages: async (id: string, options: unknown) => {
    sdk.asked.push({ id, options });
    return sdk.messages;
  },
}));

const { ClaudeProvider } = await import("../../../src/providers/claude/ClaudeProvider.js");
const { claudeHistoryFiles } = await import("../../../src/providers/claude/history.js");

const user = (uuid: string, content: unknown, timestamp?: string) => ({
  type: "user",
  uuid,
  message: { role: "user", content },
  ...(timestamp ? { timestamp } : {}),
});
const assistant = (uuid: string, id: string, content: unknown[]) => ({
  type: "assistant",
  uuid,
  message: { id, role: "assistant", model: "claude-test", content },
});

describe("Claude Code's own history", () => {
  beforeEach(() => {
    sdk.asked = [];
  });

  it("lists sessions with their directory and best title, skipping ones without a directory", async () => {
    sdk.sessions = [
      {
        sessionId: "s1",
        summary: "auto summary",
        customTitle: "Renamed",
        lastModified: Date.UTC(2026, 8, 2),
        createdAt: Date.UTC(2026, 8, 1),
        cwd: "/w/app",
        gitBranch: "main",
      },
      { sessionId: "s2", summary: "no dir", lastModified: Date.UTC(2026, 8, 3) },
    ];
    await expect(new ClaudeProvider().listSessions()).resolves.toEqual([
      {
        id: "s1",
        cwd: "/w/app",
        title: "Renamed",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
        gitBranch: "main",
      },
    ]);
  });

  it("reads a transcript as turns: prompts, then the agent's events", async () => {
    sdk.messages = [
      user("summary", "This session is being continued from a previous conversation that ran out"),
      user("p1", "读一下 README", "2026-09-02T10:00:00.000Z"),
      assistant("a1", "msg_1", [
        { type: "thinking", thinking: "先读文件" },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "README.md" } },
      ]),
      user("r1", [{ type: "tool_result", tool_use_id: "t1", content: "# Hub" }]),
      assistant("a2", "msg_2", [{ type: "text", text: "这是 Hub。" }]),
      user("i1", "[Request interrupted by user]"),
      user("p2", "<command-name>/compact</command-name><command-args>keep it</command-args>"),
      user("o2", "<local-command-stdout>Compacted</local-command-stdout>"),
    ];
    const turns = await new ClaudeProvider().readSession("s1", { cwd: "/w/app" });
    expect(sdk.asked).toEqual([{ id: "s1", options: { dir: "/w/app" } }]);
    expect(turns.map(({ id, prompt, at }) => ({ id, prompt, at }))).toEqual([
      { id: "summary", prompt: "", at: undefined },
      { id: "p1", prompt: "读一下 README", at: "2026-09-02T10:00:00.000Z" },
      { id: "p2", prompt: "/compact keep it", at: undefined },
    ]);
    expect(turns[0]?.events.map((event) => event.type)).toEqual(["notice", "turn.completed"]);
    expect(turns[1]?.events).toEqual([
      { type: "model.resolved", model: "claude-test" },
      { type: "reasoning.delta", blockId: "msg_1:0", delta: "先读文件" },
      { type: "tool.call", callId: "t1", name: "Read", input: { file_path: "README.md" } },
      { type: "tool.result", callId: "t1", output: "# Hub", isError: false },
      { type: "text.delta", blockId: "msg_2:0", delta: "这是 Hub。" },
      { type: "turn.completed" },
    ]);
  });

  it("keeps a background task's notification out of the prompts, in the turn it interrupts", async () => {
    const notification = [
      "<task-notification>",
      "<task-id>b7si5c8ty</task-id>",
      '<summary>Background command "Run full local CI gate" completed (exit code 0)</summary>',
      "</task-notification>",
    ].join("\n");
    sdk.messages = [
      user("p1", "提交并推送"),
      assistant("a1", "msg_1", [{ type: "text", text: "CI running." }]),
      user("n1", notification),
      assistant("a2", "msg_2", [{ type: "text", text: "CI green." }]),
      user("p2", "下一步"),
      assistant("a3", "msg_3", [{ type: "text", text: "Waiting on the build." }]),
      user("n2", notification),
      assistant("a4", "msg_4", [{ type: "text", text: "Built." }]),
    ];
    const provider = new ClaudeProvider();
    const turns = await provider.readSession("s1", { cwd: "/w" });
    expect(turns.map((turn) => turn.id)).toEqual(["p1", "p2"]);
    expect(turns[0]?.events.filter((event) => event.type === "text.delta")).toEqual([
      { type: "text.delta", blockId: "msg_1:0", delta: "CI running." },
      { type: "text.delta", blockId: "msg_2:0", delta: "CI green." },
    ]);
    // Correcting the last prompt drops it with the notifications after it, not just the last one.
    await expect(
      provider.rewindSession({ sessionId: "s1", cwd: "/w", dropTurns: 1 }),
    ).resolves.toEqual({ sessionId: "s1", resumeAt: "a2" });
  });

  it("ends the history at a rewind not yet applied", async () => {
    sdk.messages = [
      user("p1", "first"),
      assistant("a1", "msg_1", [{ type: "text", text: "one" }]),
      user("p2", "second"),
      assistant("a2", "msg_2", [{ type: "text", text: "two" }]),
    ];
    const turns = await new ClaudeProvider().readSession("s1", { cwd: "/w", resumeAt: "a1" });
    expect(turns.map((turn) => turn.id)).toEqual(["p1"]);
  });

  it("names the session a transcript file belongs to, and nothing else", () => {
    const { directory, sessionOf } = claudeHistoryFiles({ CLAUDE_CONFIG_DIR: "/cfg" });
    expect(directory).toBe("/cfg/projects");
    const id = "27ad8f51-1685-4bb6-8196-38d2007c4663";
    expect(sessionOf(`-Users-ada-app/${id}.jsonl`)).toBe(id);
    expect(sessionOf(`-Users-ada-app/${id}/subagents/agent-1.jsonl`)).toBeUndefined();
    expect(sessionOf("-Users-ada-app/notes.txt")).toBeUndefined();
  });
});
