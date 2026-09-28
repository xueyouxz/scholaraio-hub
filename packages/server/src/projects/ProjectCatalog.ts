/**
 * The projects and sessions the providers' own histories hold, grouped by the
 * directory each session ran in. Claude Code and Codex list their sessions
 * themselves (see `AgentProvider.listSessions`); this merges them, leaves out
 * sessions whose directory is gone, sets aside those that belong to no
 * project, and adds the directories the user added or hid.
 */

import { readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import {
  type CatalogFailure,
  type ProjectList,
  type ProjectSummary,
  type ProviderName,
  type SessionPage,
  type SessionSummary,
  sessionKey,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import type { NativeSession } from "../providers/types.js";
import { userText } from "../sessions/agent-prompt.js";
import { AsyncCache } from "../utils/async-cache.js";
import { writeFileAtomic } from "../utils/write-file-atomic.js";
import { type DirectoryRules, isDirectory, projectId, projectPath } from "./directories.js";

const log = () => loggerFor("projects");

/**
 * How long a listing stands. The history watcher forgets it as soon as a
 * provider writes; this only bounds how stale it gets where nothing is watched.
 */
const SNAPSHOT_TTL_MS = 30_000;

/** The user's changes to the list: directories added before any session ran there, and hidden ones. */
interface Preferences {
  added: string[];
  hidden: string[];
}

interface Snapshot {
  /** Every listed session, newest first. */
  sessions: SessionSummary[];
  /** Newest activity first; added projects without sessions last. */
  projects: ProjectSummary[];
  failures: CatalogFailure[];
}

/** Where a recorded directory stands now: its real path, or gone. */
type Placement = { directory: string; projectless: boolean } | null;

export interface ProjectCatalogOptions {
  providers: ProviderRegistry;
  dataDir: string;
  rules: DirectoryRules;
  /** Whether another program (a CLI in a terminal) is writing to this session now. */
  isExternal?: (provider: ProviderName, nativeId: string) => boolean;
  /** What the Hub is doing in a session now (`SessionSummary.state`). */
  activity?: (key: string) => SessionSummary["state"];
  /** Whether the user archived a session: it is left out of the lists. */
  archived?: (key: string) => boolean;
  /** A title the user gave a session in the Hub, over the provider's. */
  titleOf?: (key: string) => string | undefined;
}

export class ProjectCatalog {
  private readonly snapshots = new AsyncCache<"snapshot", Snapshot>({ ttlMs: SNAPSHOT_TTL_MS });
  private readonly file: string;
  private preferences: Preferences = { added: [], hidden: [] };
  /** Saves go out one after another, so the file ends with the last one. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly options: ProjectCatalogOptions) {
    this.file = path.join(options.dataDir, "projects.json");
  }

  async initialize(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const parsed = JSON.parse(content) as Partial<Preferences>;
      this.preferences = { added: parsed.added ?? [], hidden: parsed.hidden ?? [] };
    } catch (error) {
      // Keep the user's file for inspection instead of overwriting it.
      const aside = `${this.file}.corrupt-${Date.now()}`;
      await rename(this.file, aside);
      log().error({ err: error, movedTo: aside }, "Unreadable project list set aside");
    }
  }

  /** Forget the listing: a provider wrote to its history. */
  invalidate(): void {
    this.snapshots.delete("snapshot");
  }

  async projects(): Promise<ProjectList> {
    const { projects, failures } = await this.snapshot();
    return { projects, failures };
  }

  /** A page of one project's sessions; with `project` null, of those that belong to none. */
  async sessions(
    project: string | null,
    page: { offset: number; limit: number; provider?: ProviderName },
  ): Promise<SessionPage> {
    const { sessions, failures } = await this.snapshot();
    const matching = sessions.filter(
      (session) =>
        (project === null ? !session.projectId : session.projectId === project) &&
        (!page.provider || session.provider === page.provider),
    );
    const end = page.offset + page.limit;
    return {
      sessions: matching.slice(page.offset, end).map((session) => this.now(session)),
      nextOffset: end < matching.length ? end : null,
      failures,
    };
  }

  /** One listed session; undefined when no provider lists it (or its directory is gone). */
  async session(provider: ProviderName, nativeId: string): Promise<SessionSummary | undefined> {
    const { sessions } = await this.snapshot();
    const listed = sessions.find(
      (session) => session.provider === provider && session.nativeId === nativeId,
    );
    return listed && this.now(listed);
  }

  /** The project a directory belongs to, if any. */
  async projectOf(cwd: string): Promise<{ projectId?: string }> {
    const placement = await this.place(cwd);
    return placement && !placement.projectless ? { projectId: projectId(placement.directory) } : {};
  }

  /** A listed session with what changes by the second: the Hub's activity, another program's writes. */
  private now(session: SessionSummary): SessionSummary {
    const state = this.options.activity?.(session.id);
    const external = this.options.isExternal?.(session.provider, session.nativeId);
    const title = this.options.titleOf?.(session.id) ?? session.title;
    return {
      ...session,
      title,
      ...(state ? { state } : {}),
      ...(external ? { external } : {}),
    };
  }

  /**
   * Add a directory as a project before any session runs there. Adding one
   * that was hidden shows it again.
   */
  async add(directory: string): Promise<ProjectSummary> {
    if (!path.isAbsolute(directory)) throw new ProjectError("Enter an absolute directory path.");
    if (!(await isDirectory(directory))) throw new ProjectError("Directory not found.");
    const real = await realpath(directory);
    if (this.options.rules.isProjectless(real))
      throw new ProjectError("This directory is not a project directory.");
    await this.update({
      added: [...new Set([...this.preferences.added, real])],
      hidden: this.preferences.hidden.filter((hidden) => hidden !== real),
    });
    const listed = (await this.snapshot()).projects.find((project) => project.path === real);
    if (!listed) throw new Error(`Added project ${real} is missing from the listing`);
    return listed;
  }

  /** Hide a project and its sessions from the lists; nothing on disk changes. */
  async hide(id: string): Promise<void> {
    const directory = projectPath(id);
    if (!directory) throw new ProjectError("Unknown project.");
    await this.update({
      added: this.preferences.added.filter((added) => added !== directory),
      hidden: [...new Set([...this.preferences.hidden, directory])],
    });
  }

  /** Wait for saves in progress; called on shutdown. */
  async close(): Promise<void> {
    await this.writes;
  }

  private update(preferences: Preferences): Promise<void> {
    this.preferences = preferences;
    this.invalidate();
    const content = JSON.stringify(preferences, null, 2);
    const next = this.writes.then(() => writeFileAtomic(this.file, content));
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private snapshot(): Promise<Snapshot> {
    return this.snapshots.get("snapshot", () => this.load());
  }

  private async load(): Promise<Snapshot> {
    const failures: CatalogFailure[] = [];
    const listed = await Promise.all(
      this.options.providers.list().map(async (provider) => {
        try {
          return (await provider.listSessions()).map((session) => ({
            provider: provider.name,
            session,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log().warn({ err: error, provider: provider.name }, "Cannot list provider sessions");
          failures.push({ provider: provider.name, message });
          return [];
        }
      }),
    );
    const placements = new Map<string, Promise<Placement>>();
    const place = (cwd: string) => {
      let placement = placements.get(cwd);
      if (!placement) {
        placement = this.place(cwd);
        placements.set(cwd, placement);
      }
      return placement;
    };
    const hidden = new Set(this.preferences.hidden);
    const archived = this.options.archived ?? (() => false);
    const sessions: SessionSummary[] = [];
    for (const { provider, session } of listed.flat()) {
      const placement = await place(session.cwd);
      if (!placement || hidden.has(placement.directory)) continue;
      if (archived(sessionKey(provider, session.id))) continue;
      sessions.push(summary(provider, session, placement));
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { sessions, projects: await this.group(sessions, hidden), failures };
  }

  /** Where a session's directory stands: gone, a project, or no project's. */
  private async place(cwd: string): Promise<Placement> {
    if (!path.isAbsolute(cwd) || !(await isDirectory(cwd))) return null;
    const directory = await realpath(cwd);
    return { directory, projectless: this.options.rules.isProjectless(directory) };
  }

  private async group(sessions: SessionSummary[], hidden: Set<string>): Promise<ProjectSummary[]> {
    const projects = new Map<string, ProjectSummary>();
    for (const session of sessions) {
      if (!session.projectId) continue;
      let project = projects.get(session.projectId);
      if (!project) {
        const directory = projectPath(session.projectId) ?? session.cwd;
        project = {
          id: session.projectId,
          path: directory,
          name: path.basename(directory),
          // Sessions come newest first: the first one sets the project's activity.
          lastActivity: session.updatedAt,
          sessionCounts: {},
        };
        projects.set(project.id, project);
      }
      project.sessionCounts[session.provider] = (project.sessionCounts[session.provider] ?? 0) + 1;
    }
    for (const directory of this.preferences.added) {
      const id = projectId(directory);
      if (projects.has(id) || hidden.has(directory) || !(await isDirectory(directory))) continue;
      projects.set(id, {
        id,
        path: directory,
        name: path.basename(directory),
        lastActivity: null,
        sessionCounts: {},
      });
    }
    return [...projects.values()];
  }
}

function summary(
  provider: ProviderName,
  session: NativeSession,
  placement: NonNullable<Placement>,
): SessionSummary {
  return {
    id: sessionKey(provider, session.id),
    provider,
    nativeId: session.id,
    ...(placement.projectless ? {} : { projectId: projectId(placement.directory) }),
    cwd: session.cwd,
    // A provider titles a session by its first prompt, which for the Hub's has the library passages in it.
    title: userText(session.title),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
  };
}

/** A request about projects that cannot be met as asked. */
export class ProjectError extends Error {}
