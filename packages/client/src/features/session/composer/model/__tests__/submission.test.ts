import { describe, expect, it } from "vitest";
import { appendTranscript, hasContent, routeSubmission, withInterim } from "../submission";

describe("appendTranscript", () => {
  it("joins with exactly one space and never leads with one", () => {
    expect(appendTranscript("hello  ", "world")).toBe("hello world");
    expect(appendTranscript("", "world")).toBe("world");
  });
});

describe("withInterim", () => {
  it("only changes the display while dictation is in progress", () => {
    expect(withInterim("draft", "")).toBe("draft");
    expect(withInterim("draft ", "spoken")).toBe("draft spoken");
  });
});

describe("hasContent", () => {
  it("counts text, interim speech or attachments", () => {
    expect(hasContent("  ", "", 0)).toBe(false);
    expect(hasContent("", "said", 0)).toBe(true);
    expect(hasContent("", "", 1)).toBe(true);
  });
});

describe("routeSubmission", () => {
  it("sends while idle and queues while running", () => {
    expect(routeSubmission({ running: false, wantsQueue: false, canQueue: true })).toBe("send");
    expect(routeSubmission({ running: true, wantsQueue: false, canQueue: true })).toBe("queue");
  });

  it("refuses to queue without a queue action", () => {
    expect(routeSubmission({ running: true, wantsQueue: false, canQueue: false })).toBeNull();
    expect(routeSubmission({ running: false, wantsQueue: true, canQueue: false })).toBeNull();
  });
});
