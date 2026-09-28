import type { ProviderName } from "./types.js";

/**
 * A directory agents work in, as the providers' own session histories know it
 * (or as the user added it). Sessions are grouped by the project they ran in.
 */
export interface ProjectSummary {
  /** The directory's path, base64url-encoded: stable, and safe in a URL. */
  id: string;
  path: string;
  /** The directory's own name. */
  name: string;
  /** When its newest session last changed (ISO 8601); null for one with no sessions yet. */
  lastActivity: string | null;
  /** How many sessions each provider has kept here. */
  sessionCounts: Partial<Record<ProviderName, number>>;
}

/** One session as the project lists show it. */
export interface SessionSummary {
  /** The session's id: `sessionKey(provider, nativeId)`. */
  id: string;
  provider: ProviderName;
  /** The provider's own id: Claude's session id, Codex's thread id. */
  nativeId: string;
  /** The project it ran in; absent for a session that belongs to no project. */
  projectId?: string;
  /** The directory it ran in. */
  cwd: string;
  title: string;
  /** ISO 8601. */
  createdAt: string;
  /** When it last changed (ISO 8601). */
  updatedAt: string;
  gitBranch?: string;
  /** A turn the Hub is running in it, or a question it waits on. */
  state?: "running" | "waiting-input";
  /** Another program (a CLI in a terminal) wrote to it within the last half minute. */
  external?: boolean;
}

/** A provider whose history could not be read; its sessions are missing from the lists. */
export interface CatalogFailure {
  provider: ProviderName;
  message: string;
}

export interface ProjectList {
  projects: ProjectSummary[];
  failures: CatalogFailure[];
}

/** A page of sessions, newest first. */
export interface SessionPage {
  sessions: SessionSummary[];
  /** Where the next page starts; null on the last page. */
  nextOffset: number | null;
  failures: CatalogFailure[];
}

/** What changed, as the server pushes it to open pages (`GET /api/events`). */
export type HubEvent =
  /** Sessions or projects were added, removed or changed, or a session started or ended a turn. */
  { type: "sessions" };
