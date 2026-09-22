import { describe, expect, it } from "vitest";
import { rejectAttachments } from "../attachments";

const sized = (size: number) => ({ size });

describe("rejectAttachments", () => {
  it("accepts files within the limits", () => {
    expect(rejectAttachments(9, [sized(1)])).toBeUndefined();
  });

  it("rejects empty and oversized files", () => {
    expect(rejectAttachments(0, [sized(0)])).toMatch("25 MB");
    expect(rejectAttachments(0, [sized(3)], { maxBytes: 2, maxCount: 5 })).toBeDefined();
  });

  it("rejects going over the per-message count", () => {
    expect(rejectAttachments(10, [sized(1)])).toBe("每条消息最多添加 10 个附件");
  });
});
