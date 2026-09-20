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
    status: "queued" | "running" | "completed" | "duplicate" | "failed";
    paperId?: string;
    error?: string;
  }[];
}
export interface ReadingPosition {
  page: number;
  line: number;
  mode: "pdf" | "markdown";
}
