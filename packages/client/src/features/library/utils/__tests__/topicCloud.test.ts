import { describe, expect, it } from "vitest";
import type { ScholarTopic } from "../../../../core/api";
import { buildGlobalTopicCloud, buildTopicCloud } from "../topicCloud";

const colors = new Map<number, string>([
  [1, "#005235"],
  [2, "#753134"],
]);

function topic(partial: Partial<ScholarTopic> & Pick<ScholarTopic, "id">): ScholarTopic {
  return {
    id: partial.id,
    keywords: partial.keywords ?? [],
    paperCount: partial.paperCount ?? 1,
    name: partial.name ?? `T${partial.id}`,
  };
}

describe("buildGlobalTopicCloud", () => {
  it("aggregates repeated keywords across topics", () => {
    const words = buildGlobalTopicCloud(
      [
        topic({ id: 1, keywords: ["retrieval", "ranking"], paperCount: 12 }),
        topic({ id: 2, keywords: ["retrieval", "agents"], paperCount: 8 }),
      ],
      colors,
    );

    const ranking = words.find((word) => word.text === "ranking");
    expect(words[0]?.text).toBe("retrieval");
    expect(ranking).toBeDefined();
    expect(words[0]?.weight).toBeGreaterThan(ranking?.weight ?? 0);
  });

  it("ignores uncategorized topics", () => {
    const words = buildGlobalTopicCloud(
      [
        topic({ id: -1, keywords: ["uncategorized"], paperCount: 100 }),
        topic({ id: 1, keywords: ["retrieval"], paperCount: 3 }),
      ],
      colors,
    );

    expect(words.map((word) => word.text)).toEqual(["retrieval"]);
  });
});

describe("buildTopicCloud", () => {
  it("sizes earlier topic keywords larger than later keywords", () => {
    const words = buildTopicCloud(
      topic({ id: 1, keywords: ["retrieval", "ranking", "agents"], paperCount: 10 }),
      colors,
    );

    expect(words[2]).toBeDefined();
    expect(words[0]?.size).toBeGreaterThan(words[2]?.size ?? 0);
    expect(new Set(words.map((word) => word.color))).toEqual(new Set(["#005235"]));
  });
});
