import { describe, expect, it } from "vitest";
import {
  CreateSessionSchema,
  SendSessionMessageSchema,
  mergeReferences,
  parseSessionKey,
  sameReference,
  sessionKey,
} from "../../src/session/session.js";

describe("application session project contract", () => {
  it("allows attachment-only messages without accepting server file paths", () => {
    expect(SendSessionMessageSchema.safeParse({ id: "one", text: "" }).success).toBe(false);
    expect(
      SendSessionMessageSchema.parse({
        id: "one",
        text: "",
        attachmentIds: ["d68c3bf4-3132-47a2-8c17-a0f90f3a5e11"],
      }).text,
    ).toBe("");
    expect(
      SendSessionMessageSchema.safeParse({
        id: "one",
        text: "read",
        attachmentIds: ["/etc/passwd"],
      }).success,
    ).toBe(false);
  });
  it("creates a session with its first message, a directory and references", () => {
    const message = { id: "m1", text: "hello" };
    expect(CreateSessionSchema.parse({ provider: "claude", message })).toMatchObject({
      references: [],
      message: { id: "m1", attachmentIds: [], references: [] },
    });
    const refs = [
      { kind: "collection", id: "c1" },
      { kind: "paper", id: "p1" },
    ];
    expect(
      CreateSessionSchema.parse({ provider: "codex", cwd: "/w/app", references: refs, message }),
    ).toMatchObject({ cwd: "/w/app", references: refs });
    expect(
      CreateSessionSchema.safeParse({
        provider: "codex",
        references: [{ kind: "x", id: "1" }],
        message,
      }).success,
    ).toBe(false);
    expect(CreateSessionSchema.safeParse({ provider: "codex" }).success).toBe(false);
  });
  it("names a session by its provider and the provider's own id", () => {
    const key = sessionKey("codex", "01a0e7a4-8615-7342-aa26-fac8592cf587");
    expect(key).toBe("codex:01a0e7a4-8615-7342-aa26-fac8592cf587");
    expect(parseSessionKey(key)).toEqual({
      provider: "codex",
      nativeId: "01a0e7a4-8615-7342-aa26-fac8592cf587",
    });
    expect(parseSessionKey("gemini:abc")).toBeUndefined();
    expect(parseSessionKey("claude:../etc")).toBeUndefined();
    expect(parseSessionKey("no-provider")).toBeUndefined();
  });
});

describe("literature references", () => {
  const paper = { kind: "paper", id: "a" } as const;
  const collection = { kind: "collection", id: "a" } as const;

  it("tells references apart by kind and id", () => {
    expect(sameReference(paper, { kind: "paper", id: "a" })).toBe(true);
    expect(sameReference(paper, collection)).toBe(false);
    expect(sameReference(paper, { kind: "paper", id: "b" })).toBe(false);
  });

  it("merges two lists, each reference once and the first list first", () => {
    const other = { kind: "paper", id: "b" } as const;
    expect(mergeReferences([paper], [other, { ...paper }, collection])).toEqual([
      paper,
      other,
      collection,
    ]);
  });
});
