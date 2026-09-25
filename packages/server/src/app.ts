import type { HttpBindings } from "@hono/node-server";
import type { ProviderName } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { createStaticRoutes } from "./frontend/static.js";
import {
  type LibraryClient,
  LibraryRequestError,
  LibraryUnavailableError,
} from "./lib/LibraryClient.js";
import { loggerFor } from "./logging/logger.js";
import { hostCheck, parseAllowedHosts, requireCsrfHeader } from "./middleware/security.js";
import { claudeProvider } from "./providers/claude/ClaudeProvider.js";
import type { AgentProvider } from "./providers/types.js";
import { createLibraryRoutes } from "./routes/library.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import type { ServerSettingsService } from "./services/ServerSettingsService.js";
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
  /** The library service's client; the launcher runs the service itself. */
  library: LibraryClient;
  idleTimeoutMs?: number;
  serverSettingsService?: ServerSettingsService;
  enabledProviders?: ProviderName[];
  frontendDistPath?: string;
  scholaraioSkillsDir?: string;
  /** `ALLOWED_HOSTS`: extra hostnames the API answers besides loopback, or "*". */
  allowedHosts?: string;
  /** The profile the launcher started this server with. */
  profile?: string;
}

/** What a failed API request tells the client; for bad input, each field that was wrong. */
function messageFor(error: Error): string {
  if (!(error instanceof z.ZodError)) return error.message;
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
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
  if (error instanceof LibraryUnavailableError) return 503;
  return 500;
}

export function createApp(options: AppOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { dataDir } = options;
  const store = new SessionStore(dataDir);
  const { library } = options;
  const usage = new ProviderUsageLimitService();
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
  app.get("/api/status", async (c) =>
    c.json({ dataDir, profile: options.profile, library: await library.available() }),
  );
  if (options.serverSettingsService)
    app.route(
      "/api/settings",
      createSettingsRoutes({ serverSettingsService: options.serverSettingsService }),
    );
  // Unknown APIs must never be served the SPA index.
  app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
  app.onError((error, c) => {
    // A thrown response (body limit) stands; a bare status (malformed JSON) answers as JSON.
    if (error instanceof HTTPException)
      return error.res ? error.getResponse() : c.json({ error: error.message }, error.status);
    const status = statusFor(error);
    const request = { method: c.req.method, path: c.req.path, status };
    // A refused request is the caller's to fix; only the server's own failures need a stack.
    if (status >= 500) loggerFor("api").error({ ...request, err: error }, "Request failed");
    else loggerFor("api").info({ ...request, reason: messageFor(error) }, "Request refused");
    return c.json({ error: messageFor(error) }, status);
  });
  if (options.frontendDistPath)
    app.route("/", createStaticRoutes({ distPath: options.frontendDistPath }));
  const close = async () => {
    await sessions.close();
  };
  return { app, sessions, ready, close };
}
