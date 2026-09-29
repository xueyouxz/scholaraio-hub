import { describe, expect, it } from "vitest";
import { normalizePath, parseFileLink, relativeTo } from "../fileLinks";

describe("parseFileLink", () => {
  it("reads the paths agents link, with their lines", () => {
    expect(parseFileLink("packages/client/src/app.ts")).toEqual({
      path: "packages/client/src/app.ts",
    });
    expect(parseFileLink("src/app.ts:42")).toEqual({ path: "src/app.ts", line: 42 });
    expect(parseFileLink("/repo/src/app.ts:42:7")).toEqual({ path: "/repo/src/app.ts", line: 42 });
    expect(parseFileLink("src/app.ts:42-50")).toEqual({
      path: "src/app.ts",
      line: 42,
      endLine: 50,
    });
    expect(parseFileLink("src/app.ts#L12-L30")).toEqual({
      path: "src/app.ts",
      line: 12,
      endLine: 30,
    });
    expect(parseFileLink("README.md#L3C2")).toEqual({ path: "README.md", line: 3 });
    expect(parseFileLink("file:///repo/My%20Notes.md")).toEqual({ path: "/repo/My Notes.md" });
  });

  it("leaves web addresses, anchors and library links alone", () => {
    for (const href of [
      "https://example.com/src/app.ts:42",
      "mailto:someone@example.com",
      "javascript:alert(1)",
      "javascript:1",
      "#section",
      "//cdn.example.com/x.js",
      "/library/paper-1?mode=markdown",
      "",
      undefined,
    ])
      expect(parseFileLink(href)).toBeUndefined();
  });
});

describe("relative paths", () => {
  it("folds dot segments", () => {
    expect(normalizePath("docs/./guide/../README.md")).toBe("docs/README.md");
    expect(normalizePath("../x.md")).toBe("../x.md");
    expect(normalizePath("/repo/docs/../a.md")).toBe("/repo/a.md");
  });

  it("resolves a document's links against its own directory", () => {
    expect(relativeTo("docs/guide.md", { path: "../README.md", line: 2 })).toEqual({
      path: "README.md",
      line: 2,
    });
    expect(relativeTo("/repo/docs/guide.md", { path: "api.md" })).toEqual({
      path: "/repo/docs/api.md",
    });
    expect(relativeTo("docs/guide.md", { path: "/abs/x.ts" })).toEqual({ path: "/abs/x.ts" });
  });
});
