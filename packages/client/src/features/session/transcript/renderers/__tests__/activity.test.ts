import { describe, expect, it } from "vitest";
import { summarizeActivity } from "../activitySummary";
import { languageOf } from "../blocks";
import { changesByFile } from "../fileChanges";
import { fileChanges } from "../registry";
import { contentText, hasImageContent } from "../types";
import type { ToolView } from "../types";

const done = (name: string, input: unknown, detail?: unknown): ToolView => ({
  name,
  input,
  status: "complete",
  result: { content: "", isError: false, ...(detail === undefined ? {} : { detail }) },
  partial: false,
  inputStreaming: false,
});

const claudeEdit = done(
  "Edit",
  { file_path: "/repo/src/app.ts", old_string: "a", new_string: "b" },
  {
    structuredPatch: [
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" x", "-a", "+b", "+c"] },
    ],
  },
);

describe("fileChanges", () => {
  it("counts Claude Code's structured patch", () => {
    expect(fileChanges(claudeEdit)).toEqual([
      expect.objectContaining({ path: "/repo/src/app.ts", added: 2, removed: 1 }),
    ]);
  });

  it("reads Codex's per-file diffs", () => {
    const view = done("Edit", {
      changes: [
        { path: "a.ts", diff: "@@ -1 +1,2 @@\n-x\n+y\n+z" },
        { path: "b.ts", diff: "@@ -1 +0,0 @@\n-gone" },
      ],
    });
    expect(fileChanges(view).map(({ path, added, removed }) => [path, added, removed])).toEqual([
      ["a.ts", 2, 1],
      ["b.ts", 0, 1],
    ]);
  });

  it("shows a new file as all added lines", () => {
    const [change] = fileChanges(done("Write", { file_path: "n.md", content: "one\ntwo\n" }));
    expect(change).toMatchObject({ added: 2, removed: 0 });
    expect(change?.patch).toContain("+two");
  });

  it("ignores calls that have not finished", () => {
    expect(fileChanges({ ...claudeEdit, status: "pending" })).toEqual([]);
  });

  it("adds up several changes to the same file", () => {
    const files = changesByFile([...fileChanges(claudeEdit), ...fileChanges(claudeEdit)]);
    expect(files).toEqual([
      expect.objectContaining({ path: "/repo/src/app.ts", added: 4, removed: 2 }),
    ]);
    expect(files[0]?.patches).toHaveLength(2);
  });
});

describe("summarizeActivity", () => {
  it("says what the calls did, in order, with the lines they changed", () => {
    const views = [
      done("Bash", { command: "ls" }),
      done("Read", { file_path: "/r/a.ts" }),
      done("Bash", { command: "pwd" }),
      claudeEdit,
      done("mcp__x", {}),
    ];
    const summary = summarizeActivity(views);
    expect(summary.text).toBe("Ran 2 commands, read a.ts, edited app.ts, used 1 tool");
    expect(summary.stats).toEqual({ added: 2, removed: 1 });
  });

  it("counts files when several were read or edited", () => {
    const views = [
      done("Read", { file_path: "a" }),
      done("Read", { file_path: "b" }),
      done("Write", { file_path: "c", content: "x" }),
      done("MultiEdit", { file_path: "d", old_string: "", new_string: "y" }),
    ];
    expect(summarizeActivity(views).text).toBe("Read 2 files, edited 2 files");
  });
});

describe("tool output text", () => {
  it("takes the text of content blocks and leaves images to file parts", () => {
    const result = {
      content: [
        { type: "text", text: "caption" },
        { type: "image", source: { type: "base64", data: "AAAA" } },
      ],
      isError: false,
    };
    expect(contentText(result)).toBe("caption");
    expect(hasImageContent(result)).toBe(true);
  });

  it("picks a highlighting language from the path", () => {
    expect(languageOf("/x/app.tsx")).toBe("tsx");
    expect(languageOf("Dockerfile")).toBe("dockerfile");
    expect(languageOf("README")).toBe("text");
  });
});
