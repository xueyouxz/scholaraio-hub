import { describe, expect, it } from "vitest";
import type { ScholarPaper } from "../../../core/api";
import {
  abbreviateSource,
  buildPdfUrl,
  buildSourceDist,
  buildTypeDist,
  buildYearCounts,
  canNavigateToReader,
  canReadLayers,
  canReadPdf,
  findPaperById,
  groupByYear,
  toPaperRef,
} from "../paperUtils";
import type { PaperReference } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePaper(overrides: Partial<PaperReference> = {}): PaperReference {
  return {
    id: "paper-1",
    title: "Test Paper",
    authors: "Author A",
    source: "Nature",
    year: 2023,
    citations: "42",
    status: "ingested",
    hasPdf: true,
    isIndexed: true,
    ...overrides,
  };
}

function makeScholarPaper(overrides: Partial<ScholarPaper> = {}): ScholarPaper {
  return {
    id: "sp-1",
    dirName: "2023_test",
    title: "Scholar Paper",
    authors: "Author B",
    source: "Science",
    year: 2022,
    citations: "10",
    status: "ingested",
    hasPdf: true,
    hasPdfFile: true,
    isIndexed: false,
    ...overrides,
  };
}

// ─── buildPdfUrl ─────────────────────────────────────────────────────────────

describe("buildPdfUrl", () => {
  it("constructs the correct API path", () => {
    expect(buildPdfUrl("abc-123")).toBe("/api/scholar/api/v1/papers/abc-123/pdf");
  });

  it("handles IDs with special characters", () => {
    expect(buildPdfUrl("paper/with-slash")).toBe(
      "/api/scholar/api/v1/papers/paper%2Fwith-slash/pdf",
    );
  });
});

// ─── canReadPdf ──────────────────────────────────────────────────────────────

describe("canReadPdf", () => {
  it("returns true only when hasPdfFile is true", () => {
    expect(canReadPdf(makePaper({ hasPdfFile: true }))).toBe(true);
  });

  it("returns false when hasPdfFile is false", () => {
    expect(canReadPdf(makePaper({ hasPdfFile: false }))).toBe(false);
  });

  it("returns false when hasPdfFile is undefined", () => {
    expect(canReadPdf(makePaper({ hasPdfFile: undefined }))).toBe(false);
  });

  it("is independent of hasPdf (markdown) flag", () => {
    // paper.pdf exists but paper.md does not
    expect(canReadPdf(makePaper({ hasPdfFile: true, hasPdf: false }))).toBe(true);
    // paper.md exists but paper.pdf does not
    expect(canReadPdf(makePaper({ hasPdfFile: false, hasPdf: true }))).toBe(false);
  });
});

// ─── canReadLayers ───────────────────────────────────────────────────────────

describe("canReadLayers", () => {
  it("returns true when hasPdf (paper.md) is true", () => {
    expect(canReadLayers(makePaper({ hasPdf: true }))).toBe(true);
  });

  it("returns false when hasPdf is false", () => {
    expect(canReadLayers(makePaper({ hasPdf: false }))).toBe(false);
  });

  it("returns false when hasPdf is undefined", () => {
    expect(canReadLayers(makePaper({ hasPdf: undefined }))).toBe(false);
  });
});

// ─── canNavigateToReader ─────────────────────────────────────────────────────

describe("canNavigateToReader", () => {
  it("returns true when both hasPdf and hasPdfFile are true", () => {
    expect(canNavigateToReader(makePaper({ hasPdf: true, hasPdfFile: true }))).toBe(true);
  });

  it("returns true when only hasPdf (paper.md) is available", () => {
    expect(canNavigateToReader(makePaper({ hasPdf: true, hasPdfFile: false }))).toBe(true);
  });

  it("returns true when only hasPdfFile (paper.pdf) is available", () => {
    expect(canNavigateToReader(makePaper({ hasPdf: false, hasPdfFile: true }))).toBe(true);
  });

  it("returns false when neither hasPdf nor hasPdfFile is set", () => {
    expect(canNavigateToReader(makePaper({ hasPdf: false, hasPdfFile: false }))).toBe(false);
    expect(canNavigateToReader(makePaper({ hasPdf: undefined, hasPdfFile: undefined }))).toBe(
      false,
    );
  });
});

// ─── findPaperById ───────────────────────────────────────────────────────────

describe("findPaperById", () => {
  const papers: PaperReference[] = [
    makePaper({ id: "p1", title: "Paper One" }),
    makePaper({ id: "p2", title: "Paper Two" }),
    makePaper({ id: "p3", title: "Paper Three" }),
  ];

  it("finds the paper with the matching id", () => {
    const result = findPaperById(papers, "p2");
    expect(result?.title).toBe("Paper Two");
  });

  it("returns undefined when no paper matches", () => {
    expect(findPaperById(papers, "non-existent")).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(findPaperById([], "p1")).toBeUndefined();
  });
});

// ─── toPaperRef ──────────────────────────────────────────────────────────────

describe("toPaperRef", () => {
  it("maps all expected fields from a ScholarPaper including hasPdfFile", () => {
    const sp = makeScholarPaper({
      id: "id-42",
      title: "Mapped Title",
      authors: "A, B",
      source: "Cell",
      year: 2021,
      date: "2021-06-01",
      citations: "99",
      status: "pending",
      hasPdf: false,
      hasPdfFile: true,
      isIndexed: false,
      abstract: "An abstract.",
    });

    const ref = toPaperRef(sp);

    expect(ref).toEqual({
      id: "id-42",
      title: "Mapped Title",
      authors: "A, B",
      source: "Cell",
      year: 2021,
      date: "2021-06-01",
      citations: "99",
      status: "pending",
      hasPdf: false,
      hasPdfFile: true,
      isIndexed: false,
      abstract: "An abstract.",
    });
  });

  it("passes through hasPdfFile: undefined when not present in API response", () => {
    const sp = makeScholarPaper({ hasPdfFile: undefined });
    expect(toPaperRef(sp).hasPdfFile).toBeUndefined();
  });

  it("does not include server-only fields like dirName, doi, match, score", () => {
    const sp = makeScholarPaper({ doi: "10.1234/test", match: "query", score: 0.9 });
    const ref = toPaperRef(sp) as Record<string, unknown>;
    expect(ref.dirName).toBeUndefined();
    expect(ref.doi).toBeUndefined();
    expect(ref.match).toBeUndefined();
    expect(ref.score).toBeUndefined();
  });
});

// ─── groupByYear ─────────────────────────────────────────────────────────────

describe("groupByYear", () => {
  it("groups papers by year in descending order", () => {
    const papers: PaperReference[] = [
      makePaper({ id: "a", year: 2021 }),
      makePaper({ id: "b", year: 2023 }),
      makePaper({ id: "c", year: 2022 }),
      makePaper({ id: "d", year: 2023 }),
    ];

    const groups = groupByYear(papers);

    expect(groups.map((g) => g.year)).toEqual([2023, 2022, 2021]);
    expect(groups[0].papers.map((p) => p.id)).toEqual(["b", "d"]);
  });

  it("places papers with year 0 in a single group", () => {
    const papers: PaperReference[] = [
      makePaper({ id: "x", year: 0 }),
      makePaper({ id: "y", year: 0 }),
    ];

    const groups = groupByYear(papers);
    expect(groups).toHaveLength(1);
    expect(groups[0].year).toBe(0);
    expect(groups[0].papers).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(groupByYear([])).toEqual([]);
  });

  it("handles a single paper correctly", () => {
    const groups = groupByYear([makePaper({ year: 2024 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].year).toBe(2024);
    expect(groups[0].papers).toHaveLength(1);
  });
});

// ─── abbreviateSource ────────────────────────────────────────────────────────

describe("abbreviateSource", () => {
  it("abbreviates known journals", () => {
    expect(abbreviateSource("IEEE Transactions on Visualization and Computer Graphics")).toBe(
      "IEEE TVCG",
    );
    expect(abbreviateSource("Neural Information Processing Systems")).toBe("NeurIPS");
    expect(abbreviateSource("International Conference on Learning Representations")).toBe("ICLR");
  });

  it("returns the source unchanged when not in the map", () => {
    expect(abbreviateSource("Unknown Journal")).toBe("Unknown Journal");
    expect(abbreviateSource("Nature")).toBe("Nature");
  });
});

// ─── buildYearCounts ─────────────────────────────────────────────────────────

describe("buildYearCounts", () => {
  it("counts papers by year in ascending order", () => {
    const papers = [
      makePaper({ year: 2022 }),
      makePaper({ year: 2021 }),
      makePaper({ year: 2022 }),
    ];
    const result = buildYearCounts(papers);
    expect(result.map((r) => r.year)).toEqual([2021, 2022]);
    expect(result.find((r) => r.year === 2022)?.count).toBe(2);
  });

  it("excludes years <= 1900", () => {
    const papers = [makePaper({ year: 0 }), makePaper({ year: 2023 })];
    const result = buildYearCounts(papers);
    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2023);
  });

  it("returns empty array for empty input", () => {
    expect(buildYearCounts([])).toEqual([]);
  });
});

// ─── buildTypeDist ───────────────────────────────────────────────────────────

describe("buildTypeDist", () => {
  it("groups unknown paperType into other", () => {
    const papers = [makePaper({ id: "a" }), makePaper({ id: "b" })];
    const result = buildTypeDist(papers);
    expect(result.some((r) => r.label === "other")).toBe(true);
  });

  it("handles empty array", () => {
    expect(buildTypeDist([])).toEqual([]);
  });

  it("computes ratio correctly", () => {
    const papers: PaperReference[] = [
      { ...makePaper({ id: "a" }), paperType: "journal" } as PaperReference & { paperType: string },
      { ...makePaper({ id: "b" }), paperType: "journal" } as PaperReference & { paperType: string },
      { ...makePaper({ id: "c" }), paperType: "conference" } as PaperReference & {
        paperType: string;
      },
    ];
    const result = buildTypeDist(papers);
    const journal = result.find((r) => r.label === "期刊论文");
    expect(journal?.ratio).toBeCloseTo(2 / 3, 5);
  });
});

// ─── buildSourceDist ─────────────────────────────────────────────────────────

describe("buildSourceDist", () => {
  it("excludes empty sources", () => {
    const papers = [makePaper({ source: "" }), makePaper({ source: "Nature" })];
    const result = buildSourceDist(papers);
    expect(result.every((r) => r.label !== "")).toBe(true);
    expect(result.some((r) => r.label === "Nature")).toBe(true);
  });

  it("returns at most 6 bars", () => {
    const papers = Array.from({ length: 10 }, (_, i) =>
      makePaper({ id: String(i), source: `Journal ${i}` }),
    );
    expect(buildSourceDist(papers).length).toBeLessThanOrEqual(6);
  });

  it("returns empty array for empty input", () => {
    expect(buildSourceDist([])).toEqual([]);
  });
});
