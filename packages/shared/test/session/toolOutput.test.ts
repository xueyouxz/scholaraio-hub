import { describe, expect, it } from "vitest";
import { readNotice, readToolOutput } from "../../src/session/StoredSession.js";

describe("readToolOutput", () => {
  it("passes the envelope through", () => {
    const output = { content: "ok", isError: false, detail: { numFiles: 2 } };
    expect(readToolOutput(output)).toBe(output);
  });

  it("wraps raw content stored before the envelope existed", () => {
    expect(readToolOutput("line 1")).toEqual({ content: "line 1", isError: false });
    expect(readToolOutput({ hits: 2 })).toEqual({ content: { hits: 2 }, isError: false });
  });

  it("turns a legacy error part into an error result", () => {
    expect(readToolOutput(undefined, "exit 1")).toEqual({ content: "exit 1", isError: true });
  });
});

describe("readNotice", () => {
  it("keeps levelled notices and treats legacy strings as errors", () => {
    expect(readNotice({ level: "info", text: "retrying" })).toEqual({
      level: "info",
      text: "retrying",
    });
    expect(readNotice("failed")).toEqual({ level: "error", text: "failed" });
  });
});
