import { describe, expect, it } from "vitest";
import { groupActivity } from "../activity";
import type { Part } from "../parts";

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
const reasoning = (value: string) => ({ type: "reasoning", text: value }) as Part;
const image = { type: "file", mediaType: "image/png", url: "data:image/png;base64,AA" } as Part;
const pdf = { type: "file", mediaType: "application/pdf", url: "/a.pdf" } as Part;

const shape = (parts: Part[]) =>
  groupActivity(parts).map((segment) =>
    segment.kind === "part"
      ? segment.part.type
      : `activity(${segment.items.length}${segment.images.length ? `+${segment.images.length}img` : ""})`,
  );

describe("groupActivity", () => {
  it("folds every kind of tool call between two texts into one run", () => {
    expect(
      shape([text("a"), tool("Bash", "1"), tool("Read", "2"), tool("Edit", "3"), text("b")]),
    ).toEqual(["text", "activity(3)", "text"]);
  });

  it("leaves a lone call, or reasoning without calls, as it is", () => {
    expect(shape([text("a"), tool("Bash", "1"), text("b")])).toEqual([
      "text",
      "dynamic-tool",
      "text",
    ]);
    expect(shape([reasoning("hm"), text("b")])).toEqual(["reasoning", "text"]);
  });

  it("takes reasoning and the images tools returned into the run", () => {
    expect(shape([reasoning("hm"), tool("Read", "1"), image, tool("Bash", "2")])).toEqual([
      "activity(3+1img)",
    ]);
    expect(shape([tool("Read", "1"), image])).toEqual(["activity(1+1img)"]);
  });

  it("ends a run at questions, notices and non-image files", () => {
    expect(
      shape([
        tool("Bash", "1"),
        tool("Bash", "2"),
        tool("AskUserQuestion", "3"),
        tool("Bash", "4"),
        pdf,
        tool("Bash", "5"),
      ]),
    ).toEqual(["activity(2)", "dynamic-tool", "dynamic-tool", "file", "dynamic-tool"]);
  });

  it("does not let parts that render nothing split a run", () => {
    const segments = groupActivity([tool("Read", "a"), text("  "), tool("Read", "b")]);
    expect(segments).toMatchObject([{ kind: "activity", items: [{ index: 0 }, { index: 2 }] }]);
  });

  it("skips hidden parts", () => {
    const nested = { ...(tool("Read", "n") as object), toolMetadata: { parentCallId: "x" } };
    const segments = groupActivity([tool("Read", "a"), nested as Part, tool("Read", "b")], (part) =>
      Boolean((part as { toolMetadata?: unknown }).toolMetadata),
    );
    expect(segments).toMatchObject([{ kind: "activity", items: [{ index: 0 }, { index: 2 }] }]);
  });
});
