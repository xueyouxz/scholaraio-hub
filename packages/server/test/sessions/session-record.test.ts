import { UNTITLED_SESSION_TITLE } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/sessions/SessionStore.js";
import {
  changeOptions,
  endTurn,
  recoverAfterRestart,
  setPendingInput,
  startTurn,
} from "../../src/sessions/session-record.js";

function record(fields: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    title: UNTITLED_SESSION_TITLE,
    provider: "claude",
    paperIds: [],
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    readOnly: false,
    state: "idle",
    messages: [],
    ...fields,
  };
}

describe("session record rules", () => {
  it("starts a turn from the queued message and names an untitled session", () => {
    const session = record({
      error: "old",
      pendingOptions: ["model"],
      queuedMessages: [{ id: "m1", text: "Summarise the paper", attachmentIds: [] }],
    });
    startTurn(session, { id: "m1", text: "Summarise the paper", attachmentIds: [] }, []);
    expect(session).toMatchObject({
      state: "running",
      title: "Summarise the paper",
      queuedMessages: [],
    });
    expect(session.error).toBeUndefined();
    expect(session.pendingOptions).toBeUndefined();
    expect(session.messages).toEqual([
      { id: "m1", role: "user", parts: [{ type: "text", text: "Summarise the paper" }] },
    ]);
  });

  it("waits for input while a request is pending, and runs again once it is answered", () => {
    const session = record({ state: "running" });
    const request = {
      id: "r1",
      sessionId: "s1",
      type: "tool-approval" as const,
      prompt: "Allow Bash?",
      timestamp: "2026-09-27T00:00:00.000Z",
    };
    setPendingInput(session, request);
    expect(session.state).toBe("waiting-input");
    setPendingInput(session, undefined);
    expect(session.state).toBe("running");
    expect(session.pendingInput).toBeUndefined();
  });

  it.each([
    [{}, "idle", undefined],
    [{ error: "boom" }, "error", true],
    [{ error: "stopped", interrupted: true }, "interrupted", true],
  ] as const)("ends a turn %j as %s", (outcome, state, paused) => {
    const session = record({ state: "running" });
    endTurn(session, outcome);
    expect(session.state).toBe(state);
    expect(session.queuePaused).toBe(paused);
  });

  it("interrupts a turn cut short by a restart and holds its queue", () => {
    const session = record({
      state: "waiting-input",
      queuedMessages: [{ id: "m2", text: "next", attachmentIds: [] }],
    });
    expect(recoverAfterRestart(session)).toBe(true);
    expect(session).toMatchObject({ state: "interrupted", queuePaused: true });
    expect(recoverAfterRestart(session)).toBe(false);
  });

  it("remembers options changed during a turn for the next one", () => {
    const session = record({ model: "opus", effort: "high" });
    changeOptions(session, { model: "", effort: "low" }, true);
    expect(session.model).toBeUndefined();
    expect(session.effort).toBe("low");
    expect(session.pendingOptions).toEqual(["model", "effort"]);
  });
});
