import { describe, expect, it } from "vitest";
import { CreateSessionSchema, SendSessionMessageSchema } from "../../src/session/StoredSession.js";

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
  it("accepts old sessions and bounded optional project identity", () => {
    expect(CreateSessionSchema.parse({ provider: "claude" })).toMatchObject({ paperIds: [] });
    expect(CreateSessionSchema.parse({ provider: "codex", projectId: "研究" }).projectId).toBe(
      "研究",
    );
    expect(CreateSessionSchema.safeParse({ provider: "codex", projectId: "" }).success).toBe(false);
    expect(
      CreateSessionSchema.safeParse({ provider: "codex", projectId: "a".repeat(121) }).success,
    ).toBe(false);
  });
});
