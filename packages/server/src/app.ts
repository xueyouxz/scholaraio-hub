import path from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { resolveProfileName } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { openInFileManager } from "./files/reveal.js";
import { createStaticRoutes } from "./frontend/static.js";
import { hostCheck, parseAllowedHosts, requireCsrfHeader } from "./middleware/security.js";
import { claudeProvider } from "./providers/claude/ClaudeProvider.js";
import type { AgentProvider } from "./providers/types.js";
import { createLibraryRuntimeRoutes } from "./routes/library-runtime.js";
import { createLibraryRoutes } from "./routes/library.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { LibraryRequestError, LibraryService } from "./services/LibraryService.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import type { ServerSettingsService } from "./services/ServerSettingsService.js";
import { VectorRuntimeService } from "./services/VectorRuntimeService.js";
import { SessionService } from "./sessions/SessionService.js";
import { SessionStore } from "./sessions/SessionStore.js";
import {
  SessionConflictError,
  SessionInputError,
  SessionNotFoundError,
} from "./sessions/errors.js";
import { skillsDirectory } from "./skills/skillsDirectory.js";

export interface AppOptions {
  dataDir: string;
  /** Agent provider used when a session does not name one (defaults to Claude) */
  provider?: AgentProvider;
  /** The caller's library service, which the caller also closes; otherwise the app runs its own. */
  libraryService?: LibraryService;
  idleTimeoutMs?: number;
  serverSettingsService?: ServerSettingsService;
  enabledProviders?: string[];
  frontendDistPath?: string;
  scholaraioSkillsDir?: string;
  /** `ALLOWED_HOSTS`: extra hostnames the API answers besides loopback, or "*". */
  allowedHosts?: string;
}

/** The status a failed API request answers with, by what went wrong. */
function statusFor(error: Error): ContentfulStatusCode {
  if (error instanceof SessionNotFoundError) return 404;
  if (error instanceof SessionConflictError) return 409;
  if (
    error instanceof SessionInputError ||
    error instanceof z.ZodError ||
    error instanceof SyntaxError
  )
    return 400;
  // The library's own client errors pass through; its failures are a bad gateway.
  if (error instanceof LibraryRequestError)
    return (error.status < 500 ? error.status : 502) as ContentfulStatusCode;
  return 500;
}

export function createApp(options: AppOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { dataDir } = options;
  const store = new SessionStore(dataDir);
  const library = options.libraryService ?? new LibraryService(dataDir);
  const usage = new ProviderUsageLimitService();
  const vectorRuntime = new VectorRuntimeService(dataDir, library);
  const skillsDir = options.scholaraioSkillsDir ?? skillsDirectory(dataDir);
  const sessions = new SessionService(store, library, {
    provider: options.provider ?? claudeProvider,
    idleTimeoutMs: options.idleTimeoutMs,
    skillsDir,
    onUsageLimits: (limits) => usage.record(limits),
  });
  const ready = store.initialize();
  app.use("/api/*", hostCheck(parseAllowedHosts(options.allowedHosts)));
  app.use("/api/*", requireCsrfHeader);
  app.use("/api/*", async (_c, next) => {
    await ready;
    await next();
  });
  // Registered first: these two also decide where a project's sessions run.
  app.route("/api/library/projects", createProjectRoutes(library, store));
  app.route("/api/library/runtime", createLibraryRuntimeRoutes(vectorRuntime));
  app.route("/api/library", createLibraryRoutes(library));
  app.route("/api/sessions", createSessionRoutes(sessions, options.serverSettingsService));
  app.route("/api/skills", createSkillsRoutes({ scholaraioSkillsDir: skillsDir }));
  app.route(
    "/api/providers",
    createProvidersRoutes({
      providerUsageLimitService: usage,
      enabledProviders: options.enabledProviders,
    }),
  );
  app.get("/api/status", (c) =>
    c.json({
      dataDir,
      profile: resolveProfileName(process.env),
      library: library.available,
    }),
  );
  // Reveals a directory this Hub owns. No path comes from the browser: it names
  // which one, and the path is the library's own, checked to lie inside dataDir.
  app.post("/api/status/data-dir/open", async (c) => {
    const target = c.req.query("target") ?? "data";
    try {
      let directory = dataDir;
      if (target === "papers" || target === "workspaces") {
        const settings = await library.json<{ papersDir: string; workspaceDir: string }>(
          "/settings",
        );
        directory = path.resolve(target === "papers" ? settings.papersDir : settings.workspaceDir);
        const relative = path.relative(path.resolve(dataDir), directory);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          return c.json({ error: "该目录不在数据目录内，不能从这里打开" }, 400);
      } else if (target !== "data") {
        return c.json({ error: `未知的目录：${target}` }, 400);
      }
      openInFileManager(directory);
      return c.json({ opened: true, dataDir: directory });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "无法打开数据目录" }, 500);
    }
  });
  if (options.serverSettingsService)
    app.route(
      "/api/settings",
      createSettingsRoutes({ serverSettingsService: options.serverSettingsService }),
    );
  // Unknown APIs must never be served the SPA index.
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error("[API] request failed", error);
    return c.json({ error: error.message }, statusFor(error));
  });
  if (options.frontendDistPath)
    app.route("/", createStaticRoutes({ distPath: options.frontendDistPath }));
  const close = async () => {
    await vectorRuntime.close();
    await sessions.close();
    if (!options.libraryService) await library.close();
  };
  return { app, sessions, ready, close };
}
