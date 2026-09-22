import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexSessionEntry } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { ClaudeEventAdapter } from "../../src/sdk/providers/claude-events.js";
import type { SDKMessage } from "../../src/sdk/types.js";
import {
  normalizeClaudeRateLimitEvent,
  normalizeCodexRateLimits,
} from "../../src/services/ProviderUsageLimitService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("provider usage limit feasibility", () => {
  it("Claude Agent SDK installed in this package exposes structured rate limit events", () => {
    const sdkTypes = readFileSync(
      join(__dirname, "../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts"),
      "utf-8",
    );

    expect(sdkTypes).toContain("SDKRateLimitEvent");
    expect(sdkTypes).toContain("type: 'rate_limit_event'");
    expect(sdkTypes).toContain("'five_hour' | 'seven_day'");
    expect(sdkTypes).toContain("utilization?: number");
    expect(sdkTypes).toContain("resetsAt?: number");
  });

  it("Claude rate_limit_event reaches the hub as a rate-limit agent event", () => {
    const rateLimitMessage: SDKMessage = {
      type: "rate_limit_event",
      uuid: "rate-limit-1",
      session_id: "session-1",
      rate_limit_info: {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        utilization: 82.5,
        resetsAt: 1_777_531_200,
      },
    };

    expect(new ClaudeEventAdapter().accept(rateLimitMessage)).toMatchObject([
      { type: "rate-limit", limits: { provider: "claude", available: true } },
    ]);
    expect(normalizeClaudeRateLimitEvent("claude", rateLimitMessage)).toMatchObject({
      provider: "claude",
      available: true,
      windows: [
        {
          name: "fiveHour",
          usedPercent: 82.5,
          resetsAtEpochSeconds: 1_777_531_200,
          status: "allowed_warning",
          source: "claude-sdk-rate-limit-event",
        },
      ],
    });
  });

  it("Codex persisted token_count schema already accepts rate_limits windows", () => {
    const entry = parseCodexSessionEntry(
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-20T00:00:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 12_000,
              cached_input_tokens: 2_000,
              output_tokens: 100,
              total_tokens: 14_100,
            },
            model_context_window: 258_000,
          },
          rate_limits: {
            primary: {
              used_percent: 37,
              window_minutes: 300,
              resets_at: 1_777_531_200,
            },
            secondary: {
              used_percent: 12,
              window_minutes: 10_080,
              resets_at: 1_777_966_400,
            },
            plan_type: "plus",
          },
        },
      }),
    );

    expect(entry?.type).toBe("event_msg");
    expect(entry && entry.type === "event_msg" ? entry.payload.rate_limits : undefined).toEqual({
      primary: {
        used_percent: 37,
        window_minutes: 300,
        resets_at: 1_777_531_200,
      },
      secondary: {
        used_percent: 12,
        window_minutes: 10_080,
        resets_at: 1_777_966_400,
      },
      plan_type: "plus",
    });
  });

  it("Codex app-server rate limit payload can be mapped to 5h and weekly windows", () => {
    const limits = normalizeCodexRateLimits("codex", {
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          limitName: null,
          primary: {
            usedPercent: 39,
            windowDurationMins: 300,
            resetsAt: 1_777_531_200,
          },
          secondary: {
            usedPercent: 15,
            windowDurationMins: 10_080,
            resetsAt: 1_777_966_400,
          },
          credits: {
            hasCredits: false,
            unlimited: false,
            balance: "0",
          },
          planType: "plus",
          rateLimitReachedType: null,
        },
      },
    });

    expect(limits).toMatchObject({
      provider: "codex",
      available: true,
      windows: [
        {
          name: "fiveHour",
          usedPercent: 39,
          windowMinutes: 300,
          resetsAtEpochSeconds: 1_777_531_200,
          source: "codex-app-server",
        },
        {
          name: "weekly",
          usedPercent: 15,
          windowMinutes: 10_080,
          resetsAtEpochSeconds: 1_777_966_400,
          source: "codex-app-server",
        },
      ],
    });
  });
});
