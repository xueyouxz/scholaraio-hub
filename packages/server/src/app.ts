import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { getDataDir } from "./data-dir.js";
import { createStaticRoutes } from "./frontend/static.js";
import { hostCheckMiddleware, requireCustomHeader } from "./middleware/security.js";
import { createAppSessionRoutes } from "./routes/app-sessions.js";
import { health } from "./routes/health.js";
import { createLibraryRoutes } from "./routes/library.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createVersionRoutes } from "./routes/version.js";
import type { AgentProvider } from "./sdk/providers/types.js";
import type { ClaudeSDK, PermissionMode, RealClaudeSDKInterface } from "./sdk/types.js";
import { LibraryService } from "./services/LibraryService.js";
import type { ModelInfoService } from "./services/ModelInfoService.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import type { ServerSettingsService } from "./services/ServerSettingsService.js";
import { SessionService } from "./services/SessionService.js";
import { SessionStore } from "./sessions/SessionStore.js";
import { Supervisor } from "./supervisor/Supervisor.js";

export interface AppOptions {
  dataDir?: string;
  sdk?: ClaudeSDK;
  realSdk?: RealClaudeSDKInterface;
  provider?: AgentProvider;
  libraryService?: LibraryService;
  idleTimeoutMs?: number;
  defaultPermissionMode?: PermissionMode;
  serverSettingsService?: ServerSettingsService;
  modelInfoService?: ModelInfoService;
  enabledProviders?: string[];
  installId?: string;
  frontendDistPath?: string;
}

export function createApp(options: AppOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const dataDir = options.dataDir ?? getDataDir();
  const store = new SessionStore(dataDir);
  const library = options.libraryService ?? new LibraryService(dataDir);
  const usage = new ProviderUsageLimitService();
  const supervisor = new Supervisor({
    sdk: options.sdk,
    realSdk: options.realSdk,
    provider: options.provider,
    idleTimeoutMs: options.idleTimeoutMs,
    defaultPermissionMode: options.defaultPermissionMode,
    onProcessCreated: (process) => sessions.attach(process),
    onProviderSDKMessage: (provider, message) => usage.recordSDKMessage(provider, message),
  });
  const sessions = new SessionService(store, supervisor, library);
  const ready = store.initialize();
  app.use("/api/*", hostCheckMiddleware);
  app.use("/api/*", requireCustomHeader);
  app.use("/api/*", async (_c, next) => {
    await ready;
    await next();
  });
  app.route("/health", health);
  app.route("/api/version", createVersionRoutes({ installId: options.installId }));
  app.route("/api/library", createLibraryRoutes(library));
  app.route("/api/sessions", createAppSessionRoutes(sessions));
  app.route(
    "/api/providers",
    createProvidersRoutes({
      modelInfoService: options.modelInfoService,
      providerUsageLimitService: usage,
      enabledProviders: options.enabledProviders,
    }),
  );
  app.get("/api/status", (c) =>
    c.json({
      dataDir,
      profile: process.env.SCHOLARAIO_HUB_PROFILE ?? process.env.NODE_ENV,
      library: library.available,
    }),
  );
  if (options.serverSettingsService)
    app.route(
      "/api/settings",
      createSettingsRoutes({ serverSettingsService: options.serverSettingsService }),
    );
  // Unknown APIs must never be served the SPA index.
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  if (options.frontendDistPath)
    app.route("/", createStaticRoutes({ distPath: options.frontendDistPath }));
  const close = async () => {
    await supervisor.close();
    await sessions.close();
    await library.close();
  };
  return { app, supervisor, sessions, ready, close };
}
