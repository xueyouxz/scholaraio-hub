import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./sessionStore";

describe("sessionStore", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it("merges incoming messages into the snapshot", () => {
    useSessionStore.getState().mergeIncomingMessage({
      uuid: "msg-1",
      type: "assistant",
      content: "hello",
    });
    expect(useSessionStore.getState().snapshot.messages).toHaveLength(1);

    useSessionStore.getState().mergeIncomingMessage({
      uuid: "msg-1",
      type: "assistant",
      content: "hello world",
    });
    const messages = useSessionStore.getState().snapshot.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("hello world");
  });

  it("reset returns to the empty snapshot", () => {
    useSessionStore.getState().setError("boom");
    useSessionStore.getState().setLoading(false);
    useSessionStore.getState().mergeIncomingMessage({
      uuid: "x",
      type: "user",
      content: "hi",
    });
    useSessionStore.getState().reset();
    const state = useSessionStore.getState();
    expect(state.error).toBe("");
    expect(state.loading).toBe(true);
    expect(state.snapshot.messages).toEqual([]);
  });
});
