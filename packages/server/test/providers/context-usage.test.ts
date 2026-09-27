import { describe, expect, it, vi } from "vitest";
import { readClaudeContextUsage } from "../../src/providers/claude/ClaudeSession.js";
import {
  CodexEventAdapter,
  codexContextUsage,
} from "../../src/providers/codex/CodexEventAdapter.js";

describe("Codex context left", () => {
  it("measures usage and window above codex-rs' 12k baseline", () => {
    expect(codexContextUsage(12_000, 272_000).percent).toBe(100);
    expect(codexContextUsage(142_000, 272_000).percent).toBe(50);
    expect(codexContextUsage(300_000, 272_000).percent).toBe(0);
    expect(codexContextUsage(5_000, 10_000).percent).toBe(0);
    expect(codexContextUsage(142_000, 272_000)).toMatchObject({
      usedTokens: 142_000,
      contextWindow: 272_000,
      display: "remaining",
    });
  });

  const usage = (threadId: string, totalTokens: number, modelContextWindow: number | null) => ({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId: "turn-1",
      tokenUsage: {
        total: {
          totalTokens,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
        },
        modelContextWindow,
      },
    },
  });

  it("reports the main thread's last-turn usage only", () => {
    const adapter = new CodexEventAdapter("main");
    adapter.beginTurn("turn-1");
    expect(adapter.notification(usage("main", 142_000, 272_000))).toEqual([
      {
        type: "context.usage",
        usage: { usedTokens: 142_000, contextWindow: 272_000, percent: 50, display: "remaining" },
      },
    ]);
    expect(adapter.notification(usage("child", 142_000, 272_000))).toEqual([]);
    expect(adapter.notification(usage("main", 142_000, null))).toEqual([]);
  });
});

describe("Claude context used", () => {
  it("takes Claude Code's own /context numbers", async () => {
    const getContextUsage = vi.fn(async () => ({
      totalTokens: 50_000,
      maxTokens: 200_000,
      percentage: 25,
      isAutoCompactEnabled: true,
      autoCompactThreshold: 167_000,
    }));
    expect(
      await readClaudeContextUsage({ getContextUsage } as unknown as Parameters<
        typeof readClaudeContextUsage
      >[0]),
    ).toEqual({
      usedTokens: 50_000,
      contextWindow: 200_000,
      percent: 25,
      display: "used",
      autoCompactThreshold: 167_000,
    });
  });

  it("reports nothing rather than a guess when the CLI cannot answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await readClaudeContextUsage({
        getContextUsage: async () => Promise.reject(new Error("closed")),
      } as unknown as Parameters<typeof readClaudeContextUsage>[0]),
    ).toBeUndefined();
    warn.mockRestore();
  });
});
