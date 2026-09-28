import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../src/sessions/SessionStore.js";
import {
  changeOptions,
  endTurn,
  recordPrompt,
  recoverAfterRestart,
  rewindTo,
  setPendingInput,
  startTurn,
} from "../../src/sessions/session-record.js";

function record(fields: Partial<SessionRecord> = {}): SessionRecord {
  return {
    provider: "claude",
    nativeId: "s1",
    cwd: "/w/app",
    attachments: "3f2b7c1e-0000-4000-8000-000000000000",
    references: [],
    prompts: {},
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    state: "idle",
    ...fields,
  };
}

const prompt = (inputId: string) => ({
  inputId,
  replyId: `${inputId}-reply`,
  text: inputId,
  files: [],
});

describe("session record rules", () => {
  it("starts a turn from the queued message", () => {
    const session = record({
      error: "old",
      pendingOptions: ["model"],
      queuedMessages: [
        { id: "m1", text: "Summarise the paper", attachmentIds: [], references: [] },
      ],
    });
    startTurn(session, {
      id: "m1",
      text: "Summarise the paper",
      attachmentIds: [],
      references: [],
    });
    expect(session).toMatchObject({ state: "running", queuedMessages: [] });
    expect(session.error).toBeUndefined();
    expect(session.pendingOptions).toBeUndefined();
  });

  it("files a prompt under the provider's id, moving it once the provider names its own", () => {
    const session = record();
    recordPrompt(session, "hub-uuid", prompt("m1"));
    recordPrompt(session, "turn-7", prompt("m1"), "hub-uuid");
    expect(Object.keys(session.prompts)).toEqual(["turn-7"]);
  });

  it("waits for input while a request is pending, and runs again once it is answered", () => {
    const session = record({ state: "running" });
    const request = {
      id: "r1",
      sessionId: "claude:s1",
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
      queuedMessages: [{ id: "m2", text: "next", attachmentIds: [], references: [] }],
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

  it("drops what the Hub added to a prompt that was taken back", () => {
    const session = record({
      state: "error",
      error: "x",
      prompts: { p1: prompt("m1"), p2: prompt("m2") },
    });
    rewindTo(session, "p2", "a1");
    expect(Object.keys(session.prompts)).toEqual(["p1"]);
    expect(session).toMatchObject({ state: "idle", nativeResumeAt: "a1" });
    expect(session.error).toBeUndefined();
  });
});
