import { describe, expect, it } from "vitest";
import { contextLabel, contextLevel, contextTitle, formatTokens } from "../contextUsage";

describe("context usage display", () => {
  it("speaks Claude's share used and Codex's share left", () => {
    const claude = {
      usedTokens: 50_000,
      contextWindow: 200_000,
      percent: 25,
      display: "used",
    } as const;
    const codex = {
      usedTokens: 142_000,
      contextWindow: 272_000,
      percent: 50,
      display: "remaining",
    } as const;
    expect(contextLabel(claude)).toBe("25%");
    expect(contextLabel(codex)).toBe("50% 剩余");
    expect(contextTitle({ ...claude, autoCompactThreshold: 167_000 })).toBe(
      "上下文已用 25%（50k / 200k tokens），达到 167k 时自动压缩",
    );
  });

  it("warns as the window fills, whichever direction is reported", () => {
    const base = { usedTokens: 0, contextWindow: 1 };
    expect(contextLevel({ ...base, percent: 80, display: "used" })).toBe("warn");
    expect(contextLevel({ ...base, percent: 5, display: "remaining" })).toBe("danger");
    expect(contextLevel({ ...base, percent: 60, display: "remaining" })).toBe("ok");
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});
