import { describe, expect, it } from "vitest";
import { parseSessionStreamEvent } from "../sessionStreamEvents";

describe("parseSessionStreamEvent", () => {
  it("keeps message payload separate from the SSE envelope", () => {
    const payload = { type: "assistant", uuid: "msg-1" };

    expect(parseSessionStreamEvent("message", payload)).toEqual({
      eventType: "message",
      message: payload,
    });
  });

  it("preserves empty pending html so consumers can clear the pending region", () => {
    expect(parseSessionStreamEvent("pending", { html: "", messageId: "stream-1" })).toEqual({
      eventType: "pending",
      html: "",
      messageId: "stream-1",
    });
  });

  it("filters invalid permission modes and provider names at the stream boundary", () => {
    const event = parseSessionStreamEvent("connected", {
      state: "in-turn",
      permissionMode: "root",
      provider: "unknown-provider",
    });

    expect(event).toMatchObject({
      eventType: "connected",
      state: "in-turn",
      deferredMessages: [],
    });
    if (event.eventType === "connected") {
      expect(event.permissionMode).toBeUndefined();
      expect(event.provider).toBeUndefined();
    }
  });

  it("normalizes deferred queue messages and drops malformed entries", () => {
    expect(
      parseSessionStreamEvent("deferred-queue", {
        messages: [
          { tempId: "tmp-1", content: "hello", timestamp: "2026-05-25T00:00:00.000Z" },
          { content: "", timestamp: "2026-05-25T00:00:01.000Z" },
          { content: "missing timestamp" },
        ],
      }),
    ).toEqual({
      eventType: "deferred-queue",
      messages: [
        {
          tempId: "tmp-1",
          content: "hello",
          timestamp: "2026-05-25T00:00:00.000Z",
        },
      ],
    });
  });
});
