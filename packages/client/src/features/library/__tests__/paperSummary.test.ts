import type { LibraryPaper } from "@scholaraio-hub/shared";
import { describe, expect, it } from "vitest";
import { sortPapers, toPaperSummary } from "../paperSummary";

function libraryPaper(overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  return {
    id: "paper-1",
    title: "A Paper",
    authors: "Author A",
    year: "2022",
    doi: "",
    journal: "Science",
    abstract: "",
    hasPdf: true,
    hasMarkdown: true,
    parseStatus: "ready",
    ...overrides,
  };
}

describe("toPaperSummary", () => {
  it("names each file's presence the way the reader uses it", () => {
    expect(toPaperSummary(libraryPaper())).toMatchObject({
      source: "Science",
      year: 2022,
      status: "ingested",
      hasFullText: true,
      hasPdf: true,
    });
    expect(toPaperSummary(libraryPaper({ hasMarkdown: false }))).toMatchObject({
      status: "pending",
      hasFullText: false,
      hasPdf: true,
    });
    expect(toPaperSummary(libraryPaper({ hasMarkdown: false, hasPdf: false })).status).toBe(
      "no-pdf",
    );
  });

  it("keeps the metadata the detail panel reads", () => {
    expect(
      toPaperSummary(
        libraryPaper({
          doi: "10.1234/test",
          metadataStatus: "incomplete",
          missingMetadata: ["doi"],
        }),
      ),
    ).toMatchObject({
      doi: "10.1234/test",
      metadataStatus: "incomplete",
      missingMetadata: ["doi"],
    });
  });

  it("shows citations per source and sorts by the highest count", () => {
    const summary = toPaperSummary(libraryPaper({ citationCounts: { crossref: 12, s2: 30 } }));
    expect(summary.citations).toBe("crossref: 12 · s2: 30");
    expect(summary.citationCount).toBe(30);
    expect(toPaperSummary(libraryPaper({ citationCount: 7 }))).toMatchObject({
      citations: "7",
      citationCount: 7,
    });
    expect(toPaperSummary(libraryPaper()).citationCount).toBeNull();
  });
});

describe("sortPapers", () => {
  const papers = [
    toPaperSummary(libraryPaper({ id: "b", title: "Beta", year: "2020", citationCount: 50 })),
    toPaperSummary(libraryPaper({ id: "a", title: "Alpha", year: "2024", citationCount: 5 })),
    toPaperSummary(libraryPaper({ id: "c", title: "Gamma", year: "2022" })),
  ];
  const ids = (sort: Parameters<typeof sortPapers>[1]) =>
    sortPapers(papers, sort).map((paper) => paper.id);

  it("sorts by year, citations or title without touching its input", () => {
    expect(ids("year_desc")).toEqual(["a", "c", "b"]);
    expect(ids("citations_desc")).toEqual(["b", "a", "c"]);
    expect(ids("title_asc")).toEqual(["a", "b", "c"]);
    expect(papers.map((paper) => paper.id)).toEqual(["b", "a", "c"]);
  });
});
