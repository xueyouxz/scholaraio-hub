import { describe, expect, it } from "vitest";
import { errorMessage, formatBytes, relativeTime } from "../format";

describe("relativeTime", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MINUTE = 60_000;

  it("words the time since in the largest whole unit", () => {
    expect(relativeTime(ago(20_000), now)).toBe("刚刚");
    expect(relativeTime(ago(5 * MINUTE), now)).toBe("5分钟前");
    expect(relativeTime(ago(3 * 60 * MINUTE), now)).toBe("3小时前");
    expect(relativeTime(ago(2 * 24 * 60 * MINUTE), now)).toBe("2天前");
    expect(relativeTime(ago(15 * 24 * 60 * MINUTE), now)).toBe("2周前");
    expect(relativeTime(ago(95 * 24 * 60 * MINUTE), now)).toBe("3月前");
  });

  it("treats a time a little ahead of the clock as now", () => {
    expect(relativeTime(ago(-5_000), now)).toBe("刚刚");
  });
});

describe("formatBytes", () => {
  it("picks bytes, kilobytes or megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3482)).toBe("3.4 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.0 MB");
  });
});

describe("errorMessage", () => {
  it("uses the error's own message, else the fallback", () => {
    expect(errorMessage(new Error("disk full"), "failed")).toBe("disk full");
    expect(errorMessage(new Error(""), "failed")).toBe("failed");
    expect(errorMessage("nope", "failed")).toBe("failed");
  });
});
