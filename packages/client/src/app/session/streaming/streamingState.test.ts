import { describe, expect, it } from "vitest";
import { createStreamingAccumulator, reduceStreamingAccumulator } from "./streamingState";

describe("streamingState", () => {
  it("tracks message start and text deltas incrementally", () => {
    const state = createStreamingAccumulator();

    reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "message_start",
        message: { id: "msg-1" },
      },
    });

    reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Hello" },
      },
    });

    const result = reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.updatedMessageId).toBe("msg-1");
    expect(state.blocksByMessage.get("msg-1")?.[0]?.text).toBe("Hello world");
  });

  it("clears message blocks on message_stop", () => {
    const state = createStreamingAccumulator();
    reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "message_start",
        message: { id: "msg-2" },
      },
    });
    reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Done" },
      },
    });

    const result = reduceStreamingAccumulator(state, {
      type: "stream_event",
      event: {
        type: "message_stop",
      },
    });

    expect(result.streamEnded).toBe(true);
    expect(state.blocksByMessage.has("msg-2")).toBe(false);
  });
});
