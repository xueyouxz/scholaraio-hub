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
export interface LibraryPaperDetail extends LibraryPaper {
  markdown: string;
  l3Conclusion?: string;
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
  /** Workspace each paper joins once it is in the library. */
  projectId?: string;
  items: {
    id: string;
    name: string;
    /** What the user knows a fetched paper by, when it is not the file name. */
    title?: string;
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
    /** Why a paper that did arrive could not join the job's workspace. */
    projectError?: string;
  }[];
}

/** A paper found on the open web, with the locator the import queue fetches it by. */
export interface DiscoveredPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  arxivId: string;
  locator: string;
  openAccess: boolean;
  citations: number | null;
  source: "openalex" | "arxiv";
  /** Set when the library already holds this work. */
  paperId: string | null;
}
export interface DiscoverResponse {
  results: DiscoveredPaper[];
  /** Sources that could not answer; the others still did. */
  errors: { source: string; error: string }[];
}

/** One service tried with the current settings. */
export interface SettingsCheck {
  target: "mineru" | "llm" | "embed";
  ok: boolean;
  level: "ok" | "warning" | "error";
  message: string;
}
/** A work this paper cites; `paper` is set when the library holds it. */
export interface LibraryReference {
  doi: string;
  title: string;
  year?: string;
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
  /** For a queued task: the running task it waits behind, if any. */
  waitingFor?: LibraryTaskKind | null;
}
/** What the library can do right now, and what it would take to do more. */
export interface LibraryCapabilities {
  papers: number;
  vectors: number;
  embedProvider: string;
  embedModel: string;
  modelReady: boolean;
  /** Whether the optional embedding packages are installed in the Python env. */
  vectorRuntimeReady: boolean;
  semanticReady: boolean;
  topicsBuilt: boolean;
  /** Papers the stored topic map places; behind `vectors` means the map is out of date. */
  mappedPapers: number;
  deepPending: number;
  missingAbstracts: number;
  llmConfigured: boolean;
  mineruConfigured: boolean;
  tasks: LibraryTask[];
}

/** How the optional embedding packages install is going. */
export interface VectorRuntimeStatus {
  state: "idle" | "installing" | "ready" | "failed";
  /** Tail of the installer's output, so the browser can show what it is doing. */
  log: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
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
  /** Length of the stored MinerU token, so the field can mask it at its real length. */
  mineruKeyLength: number;
  llmConfigured: boolean;
  /** Length of the stored LLM API key; 0 when none is configured. */
  llmKeyLength: number;
  embedApiConfigured: boolean;
  /** The documented file a user can still edit by hand. */
  configPath: string;
  /** Where the library keeps its papers. */
  papersDir: string;
  /** Where each workspace's directory is created. */
  workspaceDir: string;
}

/** What the library's own audit finds wrong with what it holds. */

/** A topic the library's topic map found. */
export interface LibraryTopic {
  id: number;
  keywords: string[];
  paperCount: number;
  name: string;
}
/** One paper placed on the topic map. */
export interface ProjectionPoint {
  id: string;
  x: number;
  y: number;
  topicId: number;
  year: number;
  title: string;
}
/** GET /analytics: the topics, and where each paper sits on the map. */
export interface LibraryAnalytics {
  topics: { topics: LibraryTopic[] };
  projection: { built: boolean; points: ProjectionPoint[] };
}
/** GET /search: the matching papers, best first. */
export interface LibrarySearchResponse {
  results: { paper: LibraryPaper }[];
  notice?: string | null;
  /** Set when the mode itself cannot run, so the page can offer the remedy. */
  unavailable?: "runtime_missing" | "provider_none" | "no_vectors";
}
