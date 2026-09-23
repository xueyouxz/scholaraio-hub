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
/** A work this paper cites; `paper` is set when the library holds it. */
export interface LibraryReference {
  doi: string;
  title: string;
  year?: string;
  paper: LibraryPaper | null;
}
export interface SharedReference {
  doi: string;
  title: string;
  sharedCount: number;
  paper: LibraryPaper | null;
}
export interface ReadingPosition {
  page: number;
  line: number;
  mode: "pdf" | "markdown";
}

/** Optional library work that costs model time: run it when the user asks. */
export type LibraryTaskKind = "semantic" | "topics" | "deep" | "quality";
export interface LibraryTask {
  id: string;
  kind: LibraryTaskKind;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  /** Stage within the task, e.g. downloading the model before embedding. */
  phase?: string | null;
  done: number;
  total: number;
  summary?: string | null;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}
/** What the library can do right now, and what it would take to do more. */
export interface LibraryCapabilities {
  papers: number;
  vectors: number;
  embedProvider: string;
  embedModel: string;
  modelReady: boolean;
  semanticReady: boolean;
  topicsBuilt: boolean;
  deepPending: number;
  missingAbstracts: number;
  llmConfigured: boolean;
  mineruConfigured: boolean;
  tasks: LibraryTask[];
}

/** Library settings the browser owns; API keys are write-only. */
export interface LibrarySettings {
  extractor: string;
  pdfParser: string;
  llmBackend: string;
  llmModel: string;
  llmBaseUrl: string;
  embedProvider: string;
  embedModel: string;
  embedSource: string;
  embedDevice: string;
  mineruConfigured: boolean;
  llmConfigured: boolean;
  embedApiConfigured: boolean;
  /** The documented file a user can still edit by hand. */
  configPath: string;
}

/** How a draft's author-year citations line up with what the library holds. */
export interface CitationCheckReport {
  citations: {
    raw: string;
    author: string;
    year: string;
    status: "VERIFIED" | "NOT_IN_LIBRARY" | "AMBIGUOUS";
    matches: { paperId: string; title: string }[];
  }[];
  verified: number;
  missing: number;
  ambiguous: number;
}

/** What the library's own audit finds wrong with what it holds. */
export interface LibraryAudit {
  total: number;
  groups: {
    rule: string;
    severity: "error" | "warning" | "info";
    count: number;
    papers: { paperId: string; title: string; message: string }[];
  }[];
}
