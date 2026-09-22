import type { LibraryCitation } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { type Part, isVisiblePart } from "../parts";
import { buildTurnTree, linkCitations } from "../turnTree";

const tool = (toolName: string, id: string, parentCallId?: string) =>
  ({
    type: "dynamic-tool",
    toolName,
    toolCallId: id,
    state: "output-available",
    input: {},
    output: { content: "", isError: false },
    ...(parentCallId ? { toolMetadata: { parentCallId } } : {}),
  }) as Part;
const text = (value: string, parentCallId?: string) =>
  ({
    type: "text",
    text: value,
    ...(parentCallId ? { providerMetadata: { hub: { parentCallId } } } : {}),
  }) as Part;
const citation: LibraryCitation = {
  id: "ref-1",
  paperId: "paper/1",
  chunkId: "c1",
  title: "Paper",
  startLine: 4,
  endLine: 9,
  text: "evidence",
};

const ids = (segments: ReturnType<typeof buildTurnTree>["segments"]) =>
  segments.map((segment) =>
    segment.kind === "explored"
      ? `explored(${segment.calls.map((call) => call.index).join(",")})`
      : segment.index,
  );

describe("buildTurnTree", () => {
  it("moves a subagent's parts under the call that started it", () => {
    const parts = [
      text("plan"),
      tool("Task", "task"),
      text("child says", "task"),
      tool("Bash", "child-bash", "task"),
      text("done"),
    ];
    const turn = buildTurnTree(parts);
    expect(ids(turn.segments)).toEqual([0, 1, 4]);
    expect(ids(turn.nested.get("task")?.segments ?? [])).toEqual([2, 3]);
    expect(
      turn.nested.get("task")?.tools.map((part) => (part as { toolCallId: string }).toolCallId),
    ).toEqual(["child-bash"]);
  });

  it("keeps parts whose parent call is not in the message on the main timeline", () => {
    const turn = buildTurnTree([text("orphan", "earlier-call"), tool("Bash", "b", "earlier-call")]);
    expect(ids(turn.segments)).toEqual([0, 1]);
    expect(turn.nested.size).toBe(0);
  });

  it("groups exploration within each timeline separately", () => {
    const parts = [
      tool("Task", "task"),
      tool("Read", "a", "task"),
      tool("Grep", "b", "task"),
      tool("Read", "c"),
      tool("Glob", "d"),
    ];
    const turn = buildTurnTree(parts);
    expect(ids(turn.segments)).toEqual([0, "explored(3,4)"]);
    expect(ids(turn.nested.get("task")?.segments ?? [])).toEqual(["explored(1,2)"]);
  });

  it("collects citations and leaves them off the timeline", () => {
    const turn = buildTurnTree([
      text("see [ref-1]"),
      { type: "data-citations", id: "c", data: [citation] } as Part,
    ]);
    expect(turn.citations).toEqual([citation]);
    expect(ids(turn.segments)).toEqual([0]);
  });
});

describe("isVisiblePart", () => {
  it("hides blank text, citations, step markers and pushed state", () => {
    expect(isVisiblePart(text(" \n"))).toBe(false);
    expect(isVisiblePart({ type: "step-start" } as Part)).toBe(false);
    expect(isVisiblePart({ type: "data-citations", data: [] } as unknown as Part)).toBe(false);
    expect(isVisiblePart({ type: "data-session-state", data: { state: "running" } } as Part)).toBe(
      false,
    );
    expect(isVisiblePart(text("hi"))).toBe(true);
    expect(isVisiblePart(tool("Bash", "b"))).toBe(true);
  });
});

describe("linkCitations", () => {
  it("links known markers and leaves unknown ones", () => {
    expect(linkCitations("A [ref-1] B [ref-2]", [citation])).toBe(
      "A [1](/library/paper%2F1?mode=markdown&line=4) B [ref-2]",
    );
  });
});
