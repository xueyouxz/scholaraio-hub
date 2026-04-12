import { describe, expect, it } from "vitest";
import { collectInitialMarkdownAugments, mergeMessages, snapshotFromSessionDetail } from "./model";

describe("session model helpers", () => {
  it("collects markdown augments from text content", () => {
    const augments = collectInitialMarkdownAugments([
      {
        uuid: "assistant-1",
        type: "assistant",
        content: [{ type: "text", text: "hello", _html: "<p>hello</p>" }],
      },
    ]);

    expect(augments["assistant-1"]).toEqual({ html: "<p>hello</p>" });
  });

  it("prefers incoming messages with matching ids during merge", () => {
    const merged = mergeMessages(
      [{ uuid: "1", type: "assistant", content: "before", _source: "sdk" }],
      [{ uuid: "1", type: "assistant", content: "after", _source: "jsonl" }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("after");
    expect(merged[0]?._source).toBe("jsonl");
  });

  it("creates a snapshot with markdown augments from session detail", () => {
    const snapshot = snapshotFromSessionDetail({
      session: {
        id: "session-1",
        projectId: "project-1",
        title: "Title",
        fullTitle: "Title",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        ownership: { owner: "none" },
        provider: "claude",
        messages: [],
      },
      messages: [
        {
          uuid: "assistant-2",
          type: "assistant",
          content: [{ type: "text", text: "body", _html: "<p>body</p>" }],
        },
      ],
      ownership: { owner: "none" },
      pendingInputRequest: null,
      slashCommands: [],
    });

    expect(snapshot.markdownAugments["assistant-2"]?.html).toBe("<p>body</p>");
    expect(snapshot.messages).toHaveLength(1);
  });
});
