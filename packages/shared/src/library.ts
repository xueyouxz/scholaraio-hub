export interface LiteratureProject {
  id: string;
  name: string;
  /** Directory the agent works in; resolved by the library service. */
  path?: string;
  paperIds: string[];
  paperCount: number;
}

export interface LibraryPaper {
  id: string;
  title: string;
  authors: string;
  year: string;
  doi: string;
  journal: string;
  abstract: string;
  hasPdf: boolean;
  hasMarkdown: boolean;
  parseStatus: "ready" | "pending" | "failed";
  error?: string;
  coverImage?: string | null;
  citationCount?: number | null;
  citationCounts?: Record<string, number> | null;
  paperType?: string;
  /** "incomplete" when ingestion could not establish key metadata such as the DOI. */
  metadataStatus?: "complete" | "incomplete";
  missingMetadata?: string[];
}
export interface LibraryChunk {
  chunk_id: string;
  paper_id: string;
  title: string;
  text: string;
  start_line: number;
  end_line: number;
  section_title: string;
}
export interface LibraryPaperDetail extends LibraryPaper {
  markdown: string;
  l3Conclusion?: string;
  chunks: LibraryChunk[];
}
export interface LibrarySearchResult {
  paper: LibraryPaper;
  matches: LibraryChunk[];
}
export interface LibraryCitation {
  id: string;
  paperId: string;
  chunkId: string;
  title: string;
  startLine: number;
  endLine: number;
  text: string;
}
export interface LibraryContext {
  citations: LibraryCitation[];
  truncated: boolean;
}
export interface ImportJob {
  id: string;
  items: {
    id: string;
    name: string;
    status:
      | "queued"
      | "running"
      | "completed"
      /** Ingested, but key metadata such as the DOI is missing. */
      | "completed_incomplete"
      | "duplicate"
      | "needs_review"
      | "failed";
    /** Pipeline step currently running: mineru | extract | dedup | ingest. */
    step?: string | null;
    paperId?: string;
    missingMetadata?: string[];
    error?: string;
  }[];
}
export interface ReadingPosition {
  page: number;
  line: number;
  mode: "pdf" | "markdown";
}
