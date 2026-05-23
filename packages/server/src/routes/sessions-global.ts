import { Hono } from "hono";
import type { SessionIndexService } from "../indexes/index.js";
import type { SessionMetadataService } from "../metadata/index.js";
import type { NotificationService } from "../notifications/index.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { CodexSessionReader } from "../sessions/codex-reader.js";
import { addMissingOwnedSessions, enrichSessions } from "../sessions/enrichment.js";
import {
  type ProviderGroup,
  listSessionsAcrossProviders,
} from "../sessions/provider-resolution.js";
import type { ISessionReader } from "../sessions/types.js";
import type { ExternalSessionTracker } from "../supervisor/ExternalSessionTracker.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { Project, SessionSummary } from "../supervisor/types.js";

export interface GlobalSessionsDeps {
  scanner: ProjectScanner;
  readerFactory: (project: Project) => ISessionReader;
  supervisor?: Supervisor;
  externalTracker?: ExternalSessionTracker;
  notificationService?: NotificationService;
  sessionMetadataService?: SessionMetadataService;
  sessionIndexService?: SessionIndexService;
  codexSessionsDir?: string;
  codexReaderFactory?: (projectPath: string) => CodexSessionReader;
}

function parseProviderGroup(value: string | undefined): ProviderGroup | null | undefined {
  if (!value) return undefined;
  if (value === "claude" || value === "codex") return value;
  return null;
}

function parseBool(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function parseLimit(value: string | undefined, fallback = 50): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 500);
}

/**
 * GET /api/sessions
 * Aggregates sessions across all (or one) project. Replaces the previous
 * client-side N+1: 1 × `/api/projects` + N × `/api/projects/:id/sessions`.
 */
export function createGlobalSessionsRoute(deps: GlobalSessionsDeps): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const providerGroup = parseProviderGroup(c.req.query("provider"));
    if (providerGroup === null) {
      return c.json({ error: "Invalid provider filter" }, 400);
    }

    const projectFilter = c.req.query("project")?.trim() || undefined;
    const query = c.req.query("q")?.trim().toLowerCase() ?? "";
    const after = c.req.query("after");
    const limit = parseLimit(c.req.query("limit"));
    const includeArchived = parseBool(c.req.query("includeArchived"));
    const starredOnly = parseBool(c.req.query("starred"));

    const rawProjects = await deps.scanner.listProjects();
    const projects = projectFilter
      ? rawProjects.filter((p) => p.id === projectFilter)
      : rawProjects;

    const perProject = await Promise.all(
      projects.map(async (project) => {
        try {
          let sessions = await listSessionsAcrossProviders(
            project,
            {
              readerFactory: deps.readerFactory,
              sessionIndexService: deps.sessionIndexService,
              codexSessionsDir: deps.codexSessionsDir,
              codexReaderFactory: deps.codexReaderFactory,
            },
            undefined,
            { providerGroup: providerGroup ?? undefined },
          );
          sessions = addMissingOwnedSessions(
            deps.supervisor,
            sessions,
            project.id,
            providerGroup ?? undefined,
          );
          return enrichSessions(deps, sessions).map((session) => ({
            ...session,
            projectName: project.name ?? project.path,
          }));
        } catch (err) {
          console.error(`[/api/sessions] failed to load sessions for project ${project.id}`, err);
          return [] as (SessionSummary & { projectName: string })[];
        }
      }),
    );

    const allSessions = perProject.flat();

    const filtered = allSessions
      .filter((s) => (includeArchived ? true : !s.isArchived))
      .filter((s) => (starredOnly ? !!s.isStarred : true))
      .filter((s) => {
        if (!query) return true;
        const title = s.customTitle ?? s.title ?? "";
        return title.toLowerCase().includes(query) || s.projectName.toLowerCase().includes(query);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const afterIndex = after ? filtered.findIndex((s) => s.updatedAt === after) : -1;
    const start = afterIndex >= 0 ? afterIndex + 1 : 0;
    const page = filtered.slice(start, start + limit);

    const stats = {
      totalCount: filtered.length,
      unreadCount: filtered.filter((s) => s.hasUnread).length,
      starredCount: filtered.filter((s) => s.isStarred).length,
      archivedCount: allSessions.filter((s) => s.isArchived).length,
      providerCounts: {},
      executorCounts: {},
    };

    return c.json({
      sessions: page,
      hasMore: start + limit < filtered.length,
      stats,
      projects: rawProjects.map((p) => ({ id: p.id, name: p.name ?? p.path })),
    });
  });

  return routes;
}
