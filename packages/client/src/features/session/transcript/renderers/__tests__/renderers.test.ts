import { describe, expect, it } from "vitest";
import type { ToolPart } from "../../model/parts";
import { sameToolCall, toolView } from "../ToolCallRow";
import { editPatch, patchStats } from "../patch";
import { rendererFor, toolLabel, toolSummary } from "../registry";
import type { ToolView } from "../types";

const part = (overrides: Record<string, unknown>) =>
  ({ type: "dynamic-tool", toolCallId: "c", toolName: "Bash", ...overrides }) as ToolPart;

const done = (name: string, input: unknown, content: unknown, detail?: unknown): ToolView => ({
  name,
  input,
  status: "complete",
  result: { content, isError: false, ...(detail === undefined ? {} : { detail }) },
  partial: false,
  inputStreaming: false,
});

describe("toolView", () => {
  it("treats preliminary output as a running tool, not a finished one", () => {
    const view = toolView(
      part({
        state: "output-available",
        input: {},
        output: { content: "a", isError: false },
        preliminary: true,
      }),
      true,
    );
    expect(view).toMatchObject({ status: "pending", partial: true, result: { content: "a" } });
  });

  it("marks a failed result as an error but keeps its output", () => {
    const view = toolView(
      part({ state: "output-available", input: {}, output: { content: "exit 1", isError: true } }),
      false,
    );
    expect(view).toMatchObject({ status: "error", result: { content: "exit 1", isError: true } });
  });

  it("reads sessions stored before the output envelope", () => {
    expect(
      toolView(part({ state: "output-available", input: {}, output: "ok" }), false),
    ).toMatchObject({
      status: "complete",
      result: { content: "ok", isError: false },
    });
    expect(
      toolView(part({ state: "output-error", input: {}, errorText: "no" }), false),
    ).toMatchObject({
      status: "error",
      result: { content: "no", isError: true },
    });
  });

  it("is aborted when the turn ended without a result", () => {
    expect(toolView(part({ state: "input-available", input: {} }), false).status).toBe("aborted");
    expect(toolView(part({ state: "input-streaming", input: {} }), true)).toMatchObject({
      status: "pending",
      inputStreaming: true,
    });
  });
});

describe("tool renderers", () => {
  it("summarizes a Claude Read from its structured result", () => {
    const view = done(
      "Read",
      { file_path: "/repo/src/app.ts", offset: 10, limit: 5 },
      "     10\tline",
      {
        type: "text",
        file: { filePath: "/repo/src/app.ts", content: "a\nb", numLines: 2, startLine: 10 },
      },
    );
    expect(rendererFor("Read").summary(view)).toBe("app.ts:10-14");
    expect(rendererFor("Read").resultSummary?.(view)).toBe("2 lines");
  });

  it("summarizes a Codex command that was canonicalized to Read, without detail", () => {
    const view = done("Read", { file_path: "src/app.ts" }, "a\nb\nc");
    expect(rendererFor("Read").resultSummary?.(view)).toBe("3 lines");
  });

  it("counts Bash output lines from stdout or the raw content", () => {
    expect(rendererFor("Bash").resultSummary?.(done("Bash", { command: "ls" }, "a\nb"))).toBe(
      "2 lines",
    );
    expect(
      rendererFor("Bash").resultSummary?.(
        done("Bash", { command: "ls" }, "ignored", {
          stdout: "x\n",
          stderr: "",
          interrupted: false,
        }),
      ),
    ).toBe("1 line");
    expect(
      rendererFor("Bash").summary(
        done("Bash", { command: "pnpm test", description: "Run tests" }, ""),
      ),
    ).toBe("Run tests");
  });

  it("reports Grep matches from Claude detail or Codex content", () => {
    expect(
      rendererFor("Grep").resultSummary?.(
        done("Grep", { pattern: "x" }, "", {
          mode: "files_with_matches",
          numFiles: 0,
          filenames: [],
        }),
      ),
    ).toBe("no matches");
    expect(rendererFor("Grep").resultSummary?.(done("Grep", { pattern: "x" }, "a:1\nb:2"))).toBe(
      "2 lines",
    );
  });

  it("shows plan progress for TodoWrite and starts expanded", () => {
    const view = done(
      "TodoWrite",
      {
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress", activeForm: "Doing b" },
        ],
      },
      "Plan updated",
    );
    expect(rendererFor("TodoWrite").summary(view)).toBe("1/2 done");
    expect(rendererFor("TodoWrite").defaultExpanded?.(view)).toBe(true);
  });

  it("routes Claude Code synonyms and unknown tools", () => {
    expect(rendererFor("Agent").tool).toBe("Task");
    expect(rendererFor("MultiEdit").tool).toBe("Edit");
    expect(rendererFor("library:search").tool).toBe("*");
    expect(toolSummary("library:search", { query: "diffusion" })).toBe("diffusion");
  });
});

describe("editPatch", () => {
  it("builds a unified diff from Claude structuredPatch", () => {
    const patch = editPatch(
      { file_path: "src/a.ts" },
      {
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
        ],
      },
    );
    expect(patch).toBe("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    expect(patchStats(patch ?? "")).toEqual({ added: 1, removed: 1 });
  });

  it("adds file headers to Codex per-file diffs", () => {
    const patch = editPatch(
      { changes: [{ path: "src/b.ts", kind: "update", diff: "@@ -1 +1 @@\n-x\n+y" }] },
      undefined,
    );
    expect(patch).toBe("--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-x\n+y\n");
  });

  it("keeps diff headers well-formed for absolute paths", () => {
    const patch = editPatch(
      { file_path: "/repo/src/a.ts" },
      {
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] },
        ],
      },
    );
    expect(patch?.startsWith("--- a/repo/src/a.ts\n+++ b/repo/src/a.ts\n")).toBe(true);
  });

  it("leaves bare old/new strings to the string diff", () => {
    expect(editPatch({ file_path: "a", old_string: "x", new_string: "y" }, undefined)).toBeNull();
  });
});

describe("toolLabel", () => {
  it("reads in the present tense while running and past tense after", () => {
    const view = done("Read", { file_path: "a" }, "x");
    expect(toolLabel(rendererFor("Read"), { ...view, status: "pending" })).toBe("Reading");
    expect(toolLabel(rendererFor("Read"), view)).toBe("Read");
    expect(toolLabel(rendererFor("Bash"), { ...view, name: "Bash", status: "error" })).toBe("Ran");
  });

  it("falls back to the tool name for tools without a verb", () => {
    const view = done("library:search", {}, "x");
    expect(toolLabel(rendererFor("library:search"), view)).toBe("library:search");
  });
});

describe("question and plan renderers", () => {
  it("summarizes the first question and starts expanded", () => {
    const view = done(
      "AskUserQuestion",
      { questions: [{ question: "Which package?", options: [] }] },
      "",
    );
    expect(rendererFor("AskUserQuestion").summary(view)).toBe("Which package?");
    expect(rendererFor("AskUserQuestion").asksUser).toBe(true);
    expect(rendererFor("ExitPlanMode").asksUser).toBe(true);
    expect(rendererFor("Bash").asksUser).toBeUndefined();
  });
});

describe("sameToolCall", () => {
  const edit = (content: string) =>
    part({
      toolName: "Edit",
      state: "output-available",
      input: { file_path: "a.ts" },
      output: { content, isError: false },
    });

  it("skips re-rendering an equal part that arrived as a new object", () => {
    expect(
      sameToolCall({ part: edit("ok"), streaming: true }, { part: edit("ok"), streaming: true }),
    ).toBe(true);
  });

  it("re-renders when the call changed, the turn stopped, or nested work is attached", () => {
    expect(
      sameToolCall({ part: edit("ok"), streaming: true }, { part: edit("new"), streaming: true }),
    ).toBe(false);
    expect(
      sameToolCall({ part: edit("ok"), streaming: true }, { part: edit("ok"), streaming: false }),
    ).toBe(false);
    const nested = { node: null, toolCount: 1 };
    expect(
      sameToolCall(
        { part: edit("ok"), streaming: true, nested },
        { part: edit("ok"), streaming: true, nested },
      ),
    ).toBe(false);
  });
});
