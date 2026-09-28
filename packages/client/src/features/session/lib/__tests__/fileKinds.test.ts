import { describe, expect, it } from "vitest";
import { attachmentKind, fileExtension, viewMode } from "../fileKinds";

describe("attachmentKind", () => {
  const kind = (name: string, type = "") => attachmentKind({ name, type });

  it("reads pictures, video and audio from the media type", () => {
    expect(kind("a.bin", "image/webp")).toBe("image");
    expect(kind("a.bin", "video/quicktime")).toBe("video");
    expect(kind("a.bin", "audio/mpeg")).toBe("audio");
    expect(kind("a", "application/pdf")).toBe("pdf");
  });

  it("falls back to the extension when the browser gives no type", () => {
    expect(kind("Report.DOCX")).toBe("document");
    expect(kind("sheet.xlsx")).toBe("spreadsheet");
    expect(kind("deck.pptx")).toBe("presentation");
    expect(kind("bundle.tar.gz")).toBe("archive");
    expect(kind("main.py")).toBe("code");
    expect(kind("notes.md")).toBe("text");
  });

  it("treats other text as text and anything else as a plain file", () => {
    expect(kind("README", "text/plain")).toBe("text");
    expect(kind("blob.dat", "application/octet-stream")).toBe("file");
  });
});

describe("fileExtension", () => {
  it("is the lower-cased suffix, and empty for none or a dotfile", () => {
    expect(fileExtension("a.TAR.GZ")).toBe("gz");
    expect(fileExtension("Makefile")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});

describe("viewMode", () => {
  it("views pictures, video, PDFs and text in the browser, and nothing else", () => {
    expect(viewMode("image")).toBe("image");
    expect(viewMode("video")).toBe("video");
    expect(viewMode("pdf")).toBe("pdf");
    expect(viewMode("code")).toBe("text");
    expect(viewMode("text")).toBe("text");
    expect(viewMode("spreadsheet")).toBe("none");
    expect(viewMode("audio")).toBe("none");
  });
});
