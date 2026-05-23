import { homedir } from "node:os";
import { isUrlProjectId, toUrlProjectId } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import type { SessionIndexService } from "../indexes/index.js";
import type { ProjectMetadataService, SessionMetadataService } from "../metadata/index.js";
import type { NotificationService } from "../notifications/index.js";
import type { CodexSessionScanner } from "../projects/codex-scanner.js";
import { canonicalizeProjectPath, isAbsolutePath } from "../projects/paths.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { CodexSessionReader } from "../sessions/codex-reader.js";
import {
  addMissingOwnedSessions as addMissingOwnedSessionsShared,
  enrichSessions as enrichSessionsShared,
} from "../sessions/enrichment.js";
import {
  type ProviderGroup,
  listSessionsAcrossProviders,
} from "../sessions/provider-resolution.js";
import type { ISessionReader } from "../sessions/types.js";
import { getSkillSlashCommands } from "../skills/skillCommands.js";
import type { ExternalSessionTracker } from "../supervisor/ExternalSessionTracker.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { Project, SessionSummary } from "../supervisor/types.js";

export interface ProjectsDeps {
  scanner: ProjectScanner;
  readerFactory: (project: Project) => ISessionReader;
  supervisor?: Supervisor;
  externalTracker?: ExternalSessionTracker;
  notificationService?: NotificationService;
  sessionMetadataService?: SessionMetadataService;
  /** ProjectMetadataService for persisting added projects */
  projectMetadataService?: ProjectMetadataService;
  sessionIndexService?: SessionIndexService;
  /** Codex scanner for checking if a project has Codex sessions */
  codexScanner?: CodexSessionScanner;
  /** Codex sessions directory (defaults to ~/.codex/sessions) */
  codexSessionsDir?: string;
  /** Optional shared Codex reader factory for cross-provider session lookups */
  codexReaderFactory?: (projectPath: string) => CodexSessionReader;
}

interface ProjectActivityCounts {
  activeOwnedCount: number;
  activeExternalCount: number;
}

/**
 * Get activity counts for all projects.
 * All counts are keyed by UrlProjectId (base64url format).
 */
async function getProjectActivityCounts(
  supervisor: Supervisor | undefined,
  externalTracker: ExternalSessionTracker | undefined,
): Promise<Map<string, ProjectActivityCounts>> {
  const counts = new Map<string, ProjectActivityCounts>();

  // Count owned sessions from Supervisor (uses base64url projectId)
  if (supervisor) {
    for (const process of supervisor.getAllProcesses()) {
      const existing = counts.get(process.projectId) || {
        activeOwnedCount: 0,
        activeExternalCount: 0,
      };
      existing.activeOwnedCount++;
      counts.set(process.projectId, existing);
    }
  }

  // Count external sessions - convert to UrlProjectId for consistent keys
  if (externalTracker) {
    for (const sessionId of externalTracker.getExternalSessions()) {
      const info = await externalTracker.getExternalSessionInfoWithUrlId(sessionId);
      if (info) {
        const existing = counts.get(info.projectId) || {
          activeOwnedCount: 0,
          activeExternalCount: 0,
        };
        existing.activeExternalCount++;
        counts.set(info.projectId, existing);
      }
    }
  }

  return counts;
}

function parseProviderGroup(value: string | undefined): ProviderGroup | null | undefined {
  if (!value) return undefined;
  if (value === "claude" || value === "codex") return value;
  return null;
}

export function createProjectsRoutes(deps: ProjectsDeps): Hono {
  const routes = new Hono();

  const addMissingOwnedSessions = (
    sessions: SessionSummary[],
    projectId: string,
    providerGroup?: ProviderGroup,
  ): SessionSummary[] =>
    addMissingOwnedSessionsShared(deps.supervisor, sessions, projectId, providerGroup);

  const enrichSessions = (sessions: SessionSummary[]): SessionSummary[] =>
    enrichSessionsShared(deps, sessions);

  // GET /api/projects - List all projects
  routes.get("/", async (c) => {
    const rawProjects = await deps.scanner.listProjects();
    const activityCounts = await getProjectActivityCounts(deps.supervisor, deps.externalTracker);

    // Enrich projects with active counts (all keyed by UrlProjectId now)
    const projects = rawProjects.map((project) => {
      const counts = activityCounts.get(project.id);
      return {
        ...project,
        activeOwnedCount: counts?.activeOwnedCount ?? 0,
        activeExternalCount: counts?.activeExternalCount ?? 0,
      };
    });

    // Sort by lastActivity descending (most recent first), nulls last
    projects.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    return c.json({ projects });
  });

  // GET /api/projects/:projectId - Get project info
  routes.get("/:projectId", async (c) => {
    const projectId = c.req.param("projectId");

    // Validate projectId format at API boundary
    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    // Use getOrCreateProject to support new projects without sessions yet
    const project = await deps.scanner.getOrCreateProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ project });
  });

  // GET /api/projects/:projectId/skills - List project/user skills available as slash commands
  routes.get("/:projectId/skills", async (c) => {
    const projectId = c.req.param("projectId");
    const provider = c.req.query("provider");

    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    const project = await deps.scanner.getOrCreateProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const slashCommands = await getSkillSlashCommands(project.path, provider ?? project.provider);
    return c.json({ slashCommands });
  });

  // POST /api/projects - Add a project by path
  // Validates the path exists on disk and returns project info
  routes.post("/", async (c) => {
    let body: { path: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.path || typeof body.path !== "string") {
      return c.json({ error: "path is required" }, 400);
    }

    // Normalize path (remove trailing slashes, expand ~)
    let normalizedPath = body.path.trim();
    if (normalizedPath.startsWith("~")) {
      normalizedPath = normalizedPath.replace("~", homedir());
    }
    // Remove trailing slash/backslash
    if (normalizedPath.length > 1 && /[/\\]$/.test(normalizedPath)) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    normalizedPath = canonicalizeProjectPath(normalizedPath);

    // Validate path is absolute
    if (!isAbsolutePath(normalizedPath)) {
      return c.json({ error: "Path must be absolute" }, 400);
    }

    // Create projectId and try to get/create the project
    const projectId = toUrlProjectId(normalizedPath);
    const project = await deps.scanner.getOrCreateProject(projectId);

    if (!project) {
      return c.json({ error: "Path does not exist or is not a directory" }, 404);
    }

    // Persist the project so it appears in future listings
    if (deps.projectMetadataService) {
      await deps.projectMetadataService.addProject(projectId, normalizedPath);
      deps.scanner.invalidateCache();
    }

    return c.json({ project });
  });

  // GET /api/projects/:projectId/sessions - List sessions
  routes.get("/:projectId/sessions", async (c) => {
    const projectId = c.req.param("projectId");
    const providerGroup = parseProviderGroup(c.req.query("provider"));
    if (providerGroup === null) {
      return c.json({ error: "Invalid provider filter" }, 400);
    }

    // Validate projectId format at API boundary
    if (!isUrlProjectId(projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }

    // Use getOrCreateProject to support new projects without sessions yet
    const project = await deps.scanner.getOrCreateProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    let sessions = await listSessionsAcrossProviders(
      project,
      {
        readerFactory: deps.readerFactory,
        sessionIndexService: deps.sessionIndexService,
        codexSessionsDir: deps.codexSessionsDir,
        codexReaderFactory: deps.codexReaderFactory,
      },
      undefined,
      { providerGroup },
    );

    // Add missing owned sessions (new sessions that don't have user/assistant messages yet)
    sessions = addMissingOwnedSessions(sessions, projectId, providerGroup);

    return c.json({ sessions: enrichSessions(sessions) });
  });

  return routes;
}
