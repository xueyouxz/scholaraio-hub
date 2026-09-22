/**
 * Paper and analytics shapes consumed by the original library/search components.
 *
 * These predate the managed library API; `features/search/libraryAdapter.ts` and
 * `libraryApi.analytics` map current responses onto them so the pre-refactor
 * components render unchanged.
 */

export interface ScholarPaper {
  id: string;
  dirName: string;
  title: string;
  authors: string;
  source: string;
  year: number;
  date?: string;
  citations: string;
  status: "ingested" | "indexing" | "pending" | "no-pdf";
  /** Whether `paper.md` exists (full text available). */
  hasPdf?: boolean;
  /** Whether `paper.pdf` exists (PDF viewer available). */
  hasPdfFile?: boolean;
  isIndexed?: boolean;
  abstract?: string;
  doi?: string;
  paperType?: string;
  match?: string;
  score?: number;
  /** First image filename in the paper's images/ directory, used as cover. */
  coverImage?: string | null;
}

export interface ScholarTopic {
  id: number;
  keywords: string[];
  paperCount: number;
  name: string;
}

export interface ScholarTopicsOverview {
  built: boolean;
  topicCount?: number;
  topics: ScholarTopic[];
  computedAt?: string;
}

export interface ScholarTopicSimilarity {
  built: boolean;
  topicCount?: number;
  topics: ScholarTopic[];
  matrix: number[][];
  computedAt?: string;
}

export interface ScholarProjectionPoint {
  id: string;
  x: number;
  y: number;
  topicId: number;
  year: number;
  title: string;
}

export interface ScholarProjection {
  built: boolean;
  stale: boolean;
  vectorCount?: number;
  currentVectorCount?: number;
  computedAt?: string;
  points: ScholarProjectionPoint[];
}
