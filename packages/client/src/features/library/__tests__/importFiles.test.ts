// @vitest-environment node
// Node has the platform File (with arrayBuffer); jsdom does not.
import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  fileKey,
  locatorIn,
  looksLikePdf,
  screenFiles,
  uploadBatches,
} from "../components/import/localFiles";
import { importState } from "../components/import/pipeline";

function file(name: string, body = "%PDF-1.4\n", folderPath?: string, lastModified = 1): File {
  const created = new File([body], name, { type: "application/pdf", lastModified });
  if (folderPath) Object.defineProperty(created, "webkitRelativePath", { value: folderPath });
  return created;
}

/** Whatever mix of files and folders the user picks becomes one importable list. */
describe("screenFiles", () => {
  it("keeps PDFs, says why the rest were left out, and skips folder debris", () => {
    const { accepted, rejected } = screenFiles(
      [
        file("a.pdf"),
        file("notes.txt"),
        file("empty.pdf", ""),
        file(".DS_Store", "x", "papers/.DS_Store"),
        file("b.PDF", "%PDF-1.7", "papers/sub/b.PDF"),
        file("c.pdf", "%PDF", "__MACOSX/c.pdf"),
      ],
      new Set(),
    );

    expect(accepted.map((entry) => entry.path)).toEqual(["a.pdf", "papers/sub/b.PDF"]);
    expect(rejected).toEqual([
      { path: "notes.txt", reason: "不是 PDF" },
      { path: "empty.pdf", reason: "空文件" },
    ]);
  });

  it("lists a file once whether it was picked alone or inside its folder", () => {
    const alone = file("a.pdf");
    const inFolder = file("a.pdf", "%PDF-1.4\n", "papers/a.pdf");
    const first = screenFiles([alone], new Set());
    const second = screenFiles([inFolder], new Set(first.accepted.map((entry) => entry.key)));

    expect(fileKey(alone)).toBe(fileKey(inFolder));
    expect(second.accepted).toEqual([]);
    expect(second.rejected).toEqual([{ path: "papers/a.pdf", reason: "已在列表中" }]);
  });
});

describe("looksLikePdf", () => {
  it("reads the header rather than trusting the name", async () => {
    expect(await looksLikePdf(file("real.pdf", "%PDF-1.5 body"))).toBe(true);
    expect(await looksLikePdf(file("fake.pdf", "<html>not a pdf</html>"))).toBe(false);
  });
});

describe("uploadBatches", () => {
  it("splits by the route's file-count and byte limits", () => {
    const many = Array.from({ length: MAX_BATCH_FILES + 3 }, () => 1);
    expect(uploadBatches(many, (size) => size).map((batch) => batch.length)).toEqual([
      MAX_BATCH_FILES,
      3,
    ]);
    const big = [MAX_BATCH_BYTES - 10, 20, 5];
    expect(uploadBatches(big, (size) => size)).toEqual([[MAX_BATCH_BYTES - 10], [20, 5]]);
  });
});

describe("locatorIn", () => {
  it("recognises identifiers and leaves topics to the search", () => {
    expect(locatorIn("10.1038/s41586-021-03819-2")).toBe("10.1038/s41586-021-03819-2");
    expect(locatorIn("doi: 10.1000/abc")).toBe("10.1000/abc");
    expect(locatorIn("2401.12345v2")).toBe("2401.12345v2");
    expect(locatorIn("https://arxiv.org/abs/2401.12345")).toBe("https://arxiv.org/abs/2401.12345");
    expect(locatorIn("turbulent drag reduction")).toBeNull();
  });
});

describe("importState", () => {
  it("names the pipeline step an item is on", () => {
    expect(importState({ id: "1", name: "a.pdf", status: "running", step: "extract" })).toEqual({
      label: "提取元数据中",
      tone: "active",
      reached: 1,
    });
    expect(importState({ id: "1", name: "a.pdf", status: "failed" }).tone).toBe("error");
  });
});
