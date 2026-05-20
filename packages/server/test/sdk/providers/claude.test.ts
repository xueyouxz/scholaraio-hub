import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../../src/sdk/providers/claude.js";

class TestClaudeProvider extends ClaudeProvider {
  constructor(private readonly payload: unknown) {
    super();
  }

  protected override async readClaudeCodeOAuthAccessToken(): Promise<string> {
    return "test-access-token";
  }

  protected override async fetchClaudeOAuthUsage(_accessToken: string): Promise<unknown> {
    return this.payload;
  }
}

describe("ClaudeProvider", () => {
  describe("getUsageLimits", () => {
    it("normalizes Claude OAuth usage API windows", async () => {
      const provider = new TestClaudeProvider({
        five_hour: {
          utilization: 28,
          resets_at: "2026-05-20T17:50:00.451231+00:00",
        },
        seven_day: {
          utilization: 81,
          resets_at: "2026-05-22T09:00:00.451254+00:00",
        },
      });

      await expect(provider.getUsageLimits()).resolves.toMatchObject({
        provider: "claude",
        available: true,
        windows: [
          {
            name: "fiveHour",
            usedPercent: 28,
            resetsAt: "2026-05-20T17:50:00.451Z",
            source: "claude-oauth-usage-api",
          },
          {
            name: "weekly",
            usedPercent: 81,
            resetsAt: "2026-05-22T09:00:00.451Z",
            source: "claude-oauth-usage-api",
          },
        ],
      });
    });

    it("returns unavailable when Claude OAuth usage response has no windows", async () => {
      const provider = new TestClaudeProvider({ extra_usage: { is_enabled: false } });

      await expect(provider.getUsageLimits()).resolves.toEqual({
        provider: "claude",
        available: false,
        windows: [],
        error: "Claude OAuth usage API did not return usage limit windows.",
      });
    });
  });
});
