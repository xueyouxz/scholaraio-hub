import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/sdk/providers/claude.js";
import { normalizeClaudeOAuthUsage } from "../../src/services/ProviderUsageLimitService.js";

const RUN_REAL_PROBE = process.env.SCHOLARAIO_TEST_CLAUDE_OAUTH_USAGE === "1";
const CLAUDE_CODE_KEYCHAIN_SERVICE =
  process.env.CLAUDE_CODE_KEYCHAIN_SERVICE ?? "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL =
  process.env.CLAUDE_OAUTH_USAGE_URL ?? "https://api.anthropic.com/api/oauth/usage";

function readClaudeCodeAccessToken(): string {
  const rawCredentials = execFileSync(
    "security",
    ["find-generic-password", "-s", CLAUDE_CODE_KEYCHAIN_SERVICE, "-w"],
    { encoding: "utf8" },
  );
  const credentials = JSON.parse(rawCredentials) as {
    claudeAiOauth?: { accessToken?: unknown };
  };
  const token = credentials.claudeAiOauth?.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Claude Code Keychain credentials did not contain claudeAiOauth.accessToken");
  }
  return token;
}

describe.skipIf(!RUN_REAL_PROBE)("Claude OAuth usage real probe", () => {
  it("fetches real usage limits with the local Claude Code OAuth login", async () => {
    const accessToken = readClaudeCodeAccessToken();
    const response = await fetch(CLAUDE_OAUTH_USAGE_URL, {
      headers: {
        accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "scholaraio-hub-claude-usage-probe",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as {
      five_hour?: { utilization?: unknown; resets_at?: unknown } | null;
      seven_day?: { utilization?: unknown; resets_at?: unknown } | null;
    };

    expect(payload.five_hour).toMatchObject({
      utilization: expect.any(Number),
      resets_at: expect.any(String),
    });
    expect(payload.seven_day).toMatchObject({
      utilization: expect.any(Number),
      resets_at: expect.any(String),
    });

    const limits = normalizeClaudeOAuthUsage("claude", payload);
    expect(limits).toMatchObject({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          usedPercent: payload.five_hour?.utilization,
          source: "claude-oauth-usage-api",
        },
        {
          name: "weekly",
          usedPercent: payload.seven_day?.utilization,
          source: "claude-oauth-usage-api",
        },
      ],
    });

    console.info(
      JSON.stringify(
        {
          provider: limits?.provider,
          windows: limits?.windows.map((window) => ({
            name: window.name,
            usedPercent: window.usedPercent,
            resetsAt: window.resetsAt,
            source: window.source,
          })),
        },
        null,
        2,
      ),
    );
  });

  it("returns real usage limits through ClaudeProvider.getUsageLimits", async () => {
    const provider = new ClaudeProvider();
    const limits = await provider.getUsageLimits();

    expect(limits).toMatchObject({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          usedPercent: expect.any(Number),
          source: "claude-oauth-usage-api",
        },
        {
          name: "weekly",
          usedPercent: expect.any(Number),
          source: "claude-oauth-usage-api",
        },
      ],
    });

    console.info(
      JSON.stringify(
        {
          provider: limits.provider,
          windows: limits.windows.map((window) => ({
            name: window.name,
            usedPercent: window.usedPercent,
            resetsAt: window.resetsAt,
            source: window.source,
          })),
        },
        null,
        2,
      ),
    );
  });
});
