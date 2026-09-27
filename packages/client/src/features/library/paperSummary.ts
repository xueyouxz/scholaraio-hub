import type { LibraryPaper } from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { libraryUrl } from "../../core/http";
import { libraryApi } from "../../core/library";

/** Where a paper is in ingestion: full text ready, PDF waiting to be parsed, or metadata only. */
export type PaperStatus = "ingested" | "pending" | "no-pdf";

/** A library paper as the lists, cards, reader and detail panel show it. */
export interface PaperSummary {
  id: string;
  title: string;
  authors: string;
  source: string;
  year: number;
  doi?: string;
  /** Citations as each source counts them, for display ("crossref: 12 · s2: 10"). */
  citations: string;
  /** The highest count any source reports, for sorting; null when none has. */
  citationCount: number | null;
  status: PaperStatus;
  /** paper.md exists: the full text can be read. */
  hasFullText: boolean;
  /** paper.pdf exists: the PDF viewer can open it. */
  hasPdf: boolean;
  abstract?: string;
  coverImage?: string | null;
  paperType?: string;
  /** "incomplete" when ingestion could not establish key metadata such as the DOI. */
  metadataStatus?: "complete" | "incomplete";
  missingMetadata?: string[];
}

export function toPaperSummary(paper: LibraryPaper): PaperSummary {
  const counts = Object.values(paper.citationCounts ?? {});
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    source: paper.journal,
    year: Number(paper.year) || 0,
    doi: paper.doi,
    citations: paper.citationCounts
      ? Object.entries(paper.citationCounts)
          .map(([source, count]) => `${source}: ${count}`)
          .join(" · ")
      : paper.citationCount == null
        ? ""
        : String(paper.citationCount),
    citationCount: paper.citationCount ?? (counts.length ? Math.max(...counts) : null),
    status: paper.hasMarkdown ? "ingested" : paper.hasPdf ? "pending" : "no-pdf",
    hasFullText: paper.hasMarkdown,
    hasPdf: paper.hasPdf,
    abstract: paper.abstract,
    coverImage: paper.coverImage,
    paperType: paper.paperType,
    metadataStatus: paper.metadataStatus,
    missingMetadata: paper.missingMetadata,
  };
}

/** Every paper in the library, as the lists show them; each view filters and sorts its own. */
export const libraryPapersQuery = queryOptions({
  queryKey: ["library", "papers"],
  queryFn: ({ signal }) => libraryApi.papers(signal),
  select: (data) => data.papers.map(toPaperSummary),
});

export type PaperSort = "year_desc" | "citations_desc" | "title_asc";

export function sortPapers(papers: readonly PaperSummary[], sort: PaperSort): PaperSummary[] {
  return [...papers].sort((a, b) =>
    sort === "title_asc"
      ? a.title.localeCompare(b.title)
      : sort === "citations_desc"
        ? (b.citationCount ?? 0) - (a.citationCount ?? 0)
        : b.year - a.year,
  );
}

/** The API URL of a file in the paper's directory (`images/…` as paper.md names them). */
export function paperAssetUrl(paperId: string, filename: string): string {
  const relative = filename.startsWith("images/") ? filename : `images/${filename}`;
  return libraryUrl(
    `/papers/${encodeURIComponent(paperId)}/attachments/${relative.split("/").map(encodeURIComponent).join("/")}`,
  );
}
