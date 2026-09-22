import type { SessionMessage } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { explorationCounts, groupExploration } from "../exploration";

type Part = SessionMessage["parts"][number];

const tool = (toolName: string, id: string) =>
  ({
    type: "dynamic-tool",
    toolName,
    toolCallId: id,
    state: "output-available",
    input: {},
    output: { content: "", isError: false },
  }) as Part;
const text = (value: string) => ({ type: "text", text: value }) as Part;

const shape = (parts: Part[]) =>
  groupExploration(parts).map((segment) =>
    segment.kind === "part" ? segment.part.type : `explored(${segment.calls.length})`,
  );

describe("groupExploration", () => {
  it("groups adjacent read/search/list calls", () => {
    expect(shape([tool("Read", "a"), tool("Grep", "b"), tool("Glob", "c")])).toEqual([
      "explored(3)",
    ]);
  });

  it("leaves a single exploration call as a normal row", () => {
    expect(shape([tool("Read", "a"), tool("Bash", "b")])).toEqual(["dynamic-tool", "dynamic-tool"]);
  });

  it("splits runs at anything that renders, but not at invisible parts", () => {
    expect(
      shape([
        tool("Read", "a"),
        text("  "),
        { type: "data-citations", id: "c", data: [] } as Part,
        tool("Read", "b"),
        text("I found it."),
        tool("Read", "c"),
        tool("Edit", "d"),
      ]),
    ).toEqual(["explored(2)", "text", "dynamic-tool", "dynamic-tool"]);
  });

  it("keeps each part's original index for stable keys", () => {
    const segments = groupExploration([text("hi"), tool("Read", "a"), tool("Read", "b")]);
    expect(segments[1]).toMatchObject({ kind: "explored", calls: [{ index: 1 }, { index: 2 }] });
  });
});

describe("groupExploration with hidden parts", () => {
  it("skips parts owned by another timeline without splitting the run", () => {
    const nested = { ...tool("Bash", "sub"), toolMetadata: { parentCallId: "task" } } as Part;
    // Without `hidden` the nested call is a visible part and splits the run.
    expect(shape([tool("Read", "a"), nested, tool("Read", "b")])).toEqual([
      "dynamic-tool",
      "dynamic-tool",
      "dynamic-tool",
    ]);
    const segments = groupExploration([tool("Read", "a"), nested, tool("Read", "b")], (part) =>
      part.type === "dynamic-tool" ? part.toolCallId === "sub" : false,
    );
    expect(segments).toMatchObject([{ kind: "explored", calls: [{ index: 0 }, { index: 2 }] }]);
  });
});

describe("explorationCounts", () => {
  it("summarizes a group by kind", () => {
    const [segment] = groupExploration([
      tool("Read", "a"),
      tool("Read", "b"),
      tool("Grep", "c"),
      tool("Glob", "d"),
    ]);
    expect(segment?.kind === "explored" && explorationCounts(segment.calls)).toBe(
      "2 files · 1 search · 1 listing",
    );
  });
});
