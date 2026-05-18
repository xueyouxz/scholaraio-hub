import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { createStaticRoutes } from "./frontend/static.js";
import type { SessionIndexService } from "./indexes/index.js";
import type { ProjectMetadataService, SessionMetadataService } from "./metadata/index.js";
import type { NotificationService } from "./notifications/index.js";
import { CODEX_SESSIONS_DIR, CodexSessionScanner } from "./projects/codex-scanner.js";
import { ProjectScanner } from "./projects/scanner.js";
import { createFilesRoutes } from "./routes/files.js";
import { health } from "./routes/health.js";
import { createProcessesRoutes } from "./routes/processes.js";
import { createProjectsRoutes } from "./routes/projects.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { createScholarRoutes } from "./routes/scholar.js";
import { createSessionsRoutes } from "./routes/sessions.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createStreamsRoutes } from "./routes/streams.js";
import { type UploadDeps, createUploadRoutes } from "./routes/upload.js";
import { createVersionRoutes } from "./routes/version.js";
import type { ClaudeSDK, PermissionMode, RealClaudeSDKInterface } from "./sdk/types.js";
import type { ModelInfoService } from "./services/ModelInfoService.js";
import type { ServerSettingsService } from "./services/ServerSettingsService.js";
import { CodexSessionReader } from "./sessions/codex-reader.js";
import { findSessionSummaryAcrossProviders } from "./sessions/provider-resolution.js";
import { ClaudeSessionReader } from "./sessions/reader.js";
import type { ISessionReader } from "./sessions/types.js";
import { ExternalSessionTracker } from "./supervisor/ExternalSessionTracker.js";
import { Supervisor } from "./supervisor/Supervisor.js";
import type { Project } from "./supervisor/types.js";
import type { EventBus } from "./watcher/index.js";

export interface AppOptions {
  sdk?: ClaudeSDK;
  scholarAioApiUrl?: string;
  realSdk?: RealClaudeSDKInterface;
  projectsDir?: string;
  idleTimeoutMs?: number;
  defaultPermissionMode?: PermissionMode;
  eventBus?: EventBus;
  upgradeWebSocket?: UploadDeps["upgradeWebSocket"];
  projectScanCacheTtlMs?: number;
  maxWorkers?: number;
  idlePreemptThresholdMs?: number;
  maxUploadSizeBytes?: number;
  maxQueueSize?: number;
  serverSettingsService?: ServerSettingsService;
  modelInfoService?: ModelInfoService;
  enabledProviders?: string[];
  installId?: string;
  voiceInputEnabled?: boolean;
  sessionMetadataService?: SessionMetadataService;
  projectMetadataService?: ProjectMetadataService;
  notificationService?: NotificationService;
  sessionIndexService?: SessionIndexService;
  frontendDistPath?: string;
}

export interface AppResult {
  app: Hono<{ Bindings: HttpBindings }>;
  supervisor: Supervisor;
  scanner: ProjectScanner;
  readerFactory: (project: Project) => ISessionReader;
}

export function createApp(options: AppOptions): AppResult {
  const app = new Hono<{ Bindings: HttpBindings }>();

  const scanner = new ProjectScanner({
    projectsDir: options.projectsDir,
    projectMetadataService: options.projectMetadataService,
    eventBus: options.eventBus,
    cacheTtlMs: options.projectScanCacheTtlMs,
  });
  const codexScanner = new CodexSessionScanner();
  const readerCache = new Map<string, ISessionReader>();
  const maxReaderCacheSize = 500;

  const getOrCreateReader = <T extends ISessionReader>(key: string, factory: () => T): T => {
    const cached = readerCache.get(key);
    if (cached) return cached as T;

    const reader = factory();
    readerCache.set(key, reader);

    while (readerCache.size > maxReaderCacheSize) {
      const oldestKey = readerCache.keys().next().value;
      if (!oldestKey) break;
      readerCache.delete(oldestKey);
    }

    return reader;
  };

  const readerFactory = (project: Project): ISessionReader => {
    const modelInfoService = options.modelInfoService;
    const mergedKey =
      project.mergedSessionDirs && project.mergedSessionDirs.length > 0
        ? `::merged=${project.mergedSessionDirs.join(",")}`
        : "";

    switch (project.provider) {
      case "codex":
      case "codex-oss":
        return getOrCreateReader(
          `codex::${project.sessionDir}::${project.path}`,
          () =>
            new CodexSessionReader({
              sessionsDir: project.sessionDir,
              projectPath: project.path,
            }),
        );
      default:
        return getOrCreateReader(
          `claude::${project.sessionDir}${mergedKey}`,
          () =>
            new ClaudeSessionReader({
              sessionDir: project.sessionDir,
              additionalDirs: project.mergedSessionDirs,
              getContextWindow: modelInfoService
                ? (model, provider) => modelInfoService.getContextWindow(model, provider)
                : undefined,
            }),
        );
    }
  };

  const codexReaderFactory = (projectPath: string): CodexSessionReader =>
    getOrCreateReader(
      `codex-extra::${CODEX_SESSIONS_DIR}::${projectPath}`,
      () =>
        new CodexSessionReader({
          sessionsDir: CODEX_SESSIONS_DIR,
          projectPath,
        }),
    );

  const getSessionSummary = async (sessionId: string, projectId: string) => {
    const project = await scanner.getProject(projectId);
    if (!project) return null;

    const resolved = await findSessionSummaryAcrossProviders(project, sessionId, project.id, {
      readerFactory,
      codexSessionsDir: CODEX_SESSIONS_DIR,
      codexReaderFactory,
    });

    return resolved?.summary ?? null;
  };

  const supervisor = new Supervisor({
    sdk: options.sdk,
    realSdk: options.realSdk,
    idleTimeoutMs: options.idleTimeoutMs,
    defaultPermissionMode: options.defaultPermissionMode,
    eventBus: options.eventBus,
    maxWorkers: options.maxWorkers,
    idlePreemptThresholdMs: options.idlePreemptThresholdMs,
    maxQueueSize: options.maxQueueSize,
    onSessionSummary: getSessionSummary,
  });

  const externalTracker = options.eventBus
    ? new ExternalSessionTracker({
        eventBus: options.eventBus,
        supervisor,
        scanner,
        decayMs: 30000,
        getSessionSummary,
      })
    : undefined;

  app.use("/health/*", (c, next) => next());
  app.route("/health", health);

  app.route(
    "/api/version",
    createVersionRoutes({
      installId: options.installId,
      voiceInputEnabled: options.voiceInputEnabled,
    }),
  );

  app.route(
    "/api/projects",
    createProjectsRoutes({
      scanner,
      readerFactory,
      supervisor,
      externalTracker,
      codexScanner,
      notificationService: options.notificationService,
      sessionMetadataService: options.sessionMetadataService,
      projectMetadataService: options.projectMetadataService,
      sessionIndexService: options.sessionIndexService,
      codexSessionsDir: CODEX_SESSIONS_DIR,
      codexReaderFactory,
    }),
  );

  app.route(
    "/api/projects",
    createFilesRoutes({
      scanner,
    }),
  );

  app.route(
    "/api",
    createSessionsRoutes({
      supervisor,
      scanner,
      readerFactory,
      externalTracker,
      codexScanner,
      codexSessionsDir: CODEX_SESSIONS_DIR,
      codexReaderFactory,
      notificationService: options.notificationService,
      sessionMetadataService: options.sessionMetadataService,
      eventBus: options.eventBus,
      serverSettingsService: options.serverSettingsService,
      modelInfoService: options.modelInfoService,
    }),
  );

  app.route(
    "/api",
    createStreamsRoutes({
      supervisor,
      eventBus: options.eventBus,
    }),
  );

  app.route(
    "/api/processes",
    createProcessesRoutes({
      supervisor,
      scanner,
      readerFactory,
      processSessionSourceFactory: (process, project) => {
        switch (process.provider) {
          case "codex":
          case "codex-oss":
            return {
              reader: codexReaderFactory(project.path),
              sessionDir: CODEX_SESSIONS_DIR,
            };
          default:
            return {
              reader: readerFactory(project),
              sessionDir: project.sessionDir,
            };
        }
      },
      sessionIndexService: options.sessionIndexService,
      sessionMetadataService: options.sessionMetadataService,
    }),
  );

  app.route(
    "/api/providers",
    createProvidersRoutes({
      modelInfoService: options.modelInfoService,
      enabledProviders: options.enabledProviders ?? ["claude", "codex"],
    }),
  );

  if (options.serverSettingsService) {
    app.route(
      "/api/settings",
      createSettingsRoutes({
        serverSettingsService: options.serverSettingsService,
      }),
    );
  }

  if (options.upgradeWebSocket) {
    app.route(
      "/api",
      createUploadRoutes({
        scanner,
        upgradeWebSocket: options.upgradeWebSocket,
        maxUploadSizeBytes: options.maxUploadSizeBytes,
      }),
    );
  }

  app.route(
    "/api/scholar",
    createScholarRoutes({
      scholarAioApiUrl: options.scholarAioApiUrl ?? "http://127.0.0.1:8765",
    }),
  );

  if (options.frontendDistPath) {
    app.route("/", createStaticRoutes({ distPath: options.frontendDistPath }));
  }

  return { app, supervisor, scanner, readerFactory };
}

export const app = new Hono();
app.route("/health", health);
