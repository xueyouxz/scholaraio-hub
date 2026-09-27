import type { HttpBindings } from "@hono/node-server";
import type { ProviderName } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { createStaticRoutes } from "./frontend/static.js";
import { errorResponse, handleApiError, registerMethodFallback, requestContext } from "./http.js";
import type { LibraryClient } from "./lib/LibraryClient.js";
import { hostCheck, parseAllowedHosts, requireCsrfHeader } from "./middleware/security.js";
import { claudeProvider } from "./providers/claude/ClaudeProvider.js";
import type { AgentProvider } from "./providers/types.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createSkillsRoutes } from "./routes/skills.js";
import { createSystemRoutes } from "./routes/system.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import type { ServerSettingsService } from "./services/ServerSettingsService.js";
import { SessionService } from "./sessions/SessionService.js";
import { SessionStore } from "./sessions/SessionStore.js";

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

/** 装配应用服务、中间件和领域路由，并提供关闭入口。 */
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
  app.use("/api/*", requestContext);
  app.use("/api/*", hostCheck(parseAllowedHosts(options.allowedHosts)));
  app.use("/api/*", requireCsrfHeader);
  app.use("/api/*", async (_c, next) => {
    await ready;
    await next();
  });
  app.route("/api/sessions", createSessionRoutes(sessions, options.serverSettingsService));
  app.route("/api/skills", createSkillsRoutes({ scholaraioSkillsDir: skillsDir }));
  app.route(
    "/api/providers",
    createProvidersRoutes({
      providerUsageLimitService: usage,
      enabledProviders: options.enabledProviders,
    }),
  );
  app.route("/api", createSystemRoutes({ dataDir, profile: options.profile, library }));
  if (options.serverSettingsService)
    app.route(
      "/api/settings",
      createSettingsRoutes({
        serverSettingsService: options.serverSettingsService,
      }),
    );
  registerMethodFallback(app);
  app.all("/api/*", (c) => errorResponse(c, "ROUTE_NOT_FOUND", "Endpoint not found."));
  app.onError(handleApiError);
  if (options.frontendDistPath)
    app.route(
      "/",
      createStaticRoutes({
        distPath: options.frontendDistPath,
        libraryPort: library.port,
      }),
    );
  const close = async () => {
    await sessions.close();
  };
  return { app, sessions, ready, close };
}
