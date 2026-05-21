import type { ProviderName, UrlProjectId } from "@scholaraio-hub/shared";
import type { ISessionIndexService } from "../indexes/types.js";
import { canonicalizeProjectPath } from "../projects/paths.js";
import type { Project, SessionSummary } from "../supervisor/types.js";
import { CodexSessionReader } from "./codex-reader.js";
import { ClaudeSessionReader } from "./reader.js";
import type { ISessionReader } from "./types.js";

export type ProviderGroup = "claude" | "codex";

export interface ProviderProjectCatalog {
  codexPaths: Set<string>;
}

export interface ProviderResolutionDeps {
  readerFactory: (project: Project) => ISessionReader;
  sessionIndexService?: ISessionIndexService;
  codexSessionsDir?: string;
  codexReaderFactory?: (projectPath: string) => CodexSessionReader;
}

export interface ListSessionsOptions {
  providerGroup?: ProviderGroup;
}

export interface SessionSource {
  provider: ProviderName;
  reader: ISessionReader;
  sessionDir: string;
  kind: "primary" | "codex";
}

export interface ResolvedSessionSummary {
  source: SessionSource;
  summary: SessionSummary;
}

function normalizeProviderGroup(provider: ProviderName | string | undefined): ProviderGroup | null {
  if (!provider) return null;
  if (provider === "codex" || provider === "codex-oss") return "codex";
  if (provider === "claude" || provider === "claude-ollama") return "claude";
  return null;
}

function mayHaveCodexSessions(project: Project, catalog?: ProviderProjectCatalog): boolean {
  if (catalog) {
    return catalog.codexPaths.has(canonicalizeProjectPath(project.path));
  }
  return normalizeProviderGroup(project.provider) === "claude";
}

function createClaudeSource(project: Project, deps: ProviderResolutionDeps): SessionSource {
  if (normalizeProviderGroup(project.provider) !== "claude") {
    throw new Error(`Cannot create Claude source for ${project.provider} project`);
  }

  return {
    provider: project.provider,
    reader: deps.readerFactory(project),
    sessionDir: project.sessionDir,
    kind: "primary",
  };
}

function createCodexSource(project: Project, deps: ProviderResolutionDeps): SessionSource | null {
  const reader =
    deps.codexReaderFactory?.(project.path) ??
    (deps.codexSessionsDir
      ? new CodexSessionReader({
          sessionsDir: deps.codexSessionsDir,
          projectPath: project.path,
        })
      : null);
  if (!reader) return null;
  return {
    provider: "codex",
    reader,
    sessionDir: deps.codexSessionsDir ?? project.sessionDir,
    kind: "codex",
  };
}

function buildCandidateGroups(
  project: Project,
  preferredProvider: ProviderName | string | undefined,
  catalog?: ProviderProjectCatalog,
  preferredOnly = false,
): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  const pushGroup = (group: ProviderGroup | null) => {
    if (!group || groups.includes(group)) return;
    groups.push(group);
  };

  const preferredGroup = normalizeProviderGroup(preferredProvider);
  const projectGroup = normalizeProviderGroup(project.provider);

  pushGroup(preferredGroup);
  if (preferredGroup && preferredOnly) {
    return groups;
  }

  pushGroup(projectGroup);

  if (mayHaveCodexSessions(project, catalog)) {
    pushGroup("codex");
  }

  return groups;
}

function getSourceForGroup(
  project: Project,
  deps: ProviderResolutionDeps,
  group: ProviderGroup,
  catalog?: ProviderProjectCatalog,
): SessionSource | null {
  switch (group) {
    case "claude":
      if (normalizeProviderGroup(project.provider) !== "claude") return null;
      return createClaudeSource(project, deps);
    case "codex":
      return createCodexSource(project, deps);
  }
}

function getSessionSources(
  project: Project,
  deps: ProviderResolutionDeps,
  preferredProvider?: ProviderName | string,
  catalog?: ProviderProjectCatalog,
  preferredOnly = false,
): SessionSource[] {
  const sources: SessionSource[] = [];
  for (const group of buildCandidateGroups(project, preferredProvider, catalog, preferredOnly)) {
    const source = getSourceForGroup(project, deps, group, catalog);
    if (!source) continue;
    if (
      sources.some(
        (existing) => existing.kind === source.kind && existing.sessionDir === source.sessionDir,
      )
    ) {
      continue;
    }
    sources.push(source);
  }
  return sources;
}

async function listSessionsForSource(
  project: Project,
  source: SessionSource,
  deps: ProviderResolutionDeps,
): Promise<SessionSummary[]> {
  if (!deps.sessionIndexService) {
    return source.reader.listSessions(project.id);
  }

  let sessions = await deps.sessionIndexService.getSessionsWithCache(
    source.sessionDir,
    project.id,
    source.reader,
  );

  if (source.kind === "primary" && normalizeProviderGroup(project.provider) === "claude") {
    for (const dir of project.mergedSessionDirs ?? []) {
      const mergedReader = new ClaudeSessionReader({ sessionDir: dir });
      const merged = await deps.sessionIndexService.getSessionsWithCache(
        dir,
        project.id,
        mergedReader,
      );
      sessions = [...sessions, ...merged];
    }
  }

  return sessions;
}

export async function listSessionsAcrossProviders(
  project: Project,
  deps: ProviderResolutionDeps,
  catalog?: ProviderProjectCatalog,
  options: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const sessions: SessionSummary[] = [];
  const seenSessionIds = new Set<string>();

  for (const source of getSessionSources(project, deps, options.providerGroup, catalog, true)) {
    const sourceSessions = await listSessionsForSource(project, source, deps);
    for (const session of sourceSessions) {
      if (seenSessionIds.has(session.id)) continue;
      seenSessionIds.add(session.id);
      sessions.push(session);
    }
  }

  return sessions;
}

export async function findSessionSummaryAcrossProviders(
  project: Project,
  sessionId: string,
  projectId: UrlProjectId,
  deps: ProviderResolutionDeps,
  preferredProvider?: ProviderName | string,
): Promise<ResolvedSessionSummary | null> {
  for (const source of getSessionSources(project, deps, preferredProvider)) {
    const summary = await source.reader.getSessionSummary(sessionId, projectId);
    if (summary) {
      return { source, summary };
    }
  }

  return null;
}
