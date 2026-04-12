import * as fs from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { attachUnifiedUpgradeHandler } from "./frontend/index.js";
import { ensureSelfSignedCertificate } from "./https/self-signed.js";
import { SessionIndexService } from "./indexes/index.js";
import { getLogFilePath, initLogger, interceptConsole } from "./logging/index.js";
import { ProjectMetadataService, SessionMetadataService } from "./metadata/index.js";
import { NotificationService } from "./notifications/index.js";
import { createUploadRoutes } from "./routes/upload.js";
import { detectClaudeCli, detectCodexCli } from "./sdk/cli-detection.js";
import { initMessageLogger } from "./sdk/messageLogger.js";
import { RealClaudeSDK } from "./sdk/real.js";
import { InstallService, ModelInfoService, ServerSettingsService } from "./services/index.js";
import { EventBus, FileWatcher } from "./watcher/index.js";

process.setMaxListeners(50);

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason ?? "unknown");
  const stack = reason instanceof Error ? reason.stack : undefined;

  const isTransportError =
    message.includes("ProcessTransport is not ready") || message.includes("not ready for writing");

  if (isTransportError) {
    console.warn(
      `[unhandledRejection] SDK transport error (session process likely died): ${message}`,
    );
  } else {
    console.error(`[unhandledRejection] ${message}`);
    if (stack) {
      console.error(stack);
    }
  }
});

const config = loadConfig();

let supervisorForShutdown: Awaited<ReturnType<typeof createApp>>["supervisor"] | null = null;
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`[Shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  console.log(`[Shutdown] Received ${signal}, cleaning up...`);

  if (supervisorForShutdown) {
    const processes = supervisorForShutdown.getAllProcesses();
    if (processes.length > 0) {
      console.log(`[Shutdown] Aborting ${processes.length} active session(s)...`);
      await Promise.all(
        processes.map(async (p) => {
          try {
            await p.abort();
            console.log(`[Shutdown] Aborted session ${p.sessionId}`);
          } catch (error) {
            console.error(`[Shutdown] Error aborting session ${p.sessionId}:`, error);
          }
        }),
      );
    }
  }

  console.log("[Shutdown] Cleanup complete, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

initLogger({
  logDir: config.logDir,
  logFile: config.logFile,
  consoleLevel: config.logLevel,
  fileLevel: config.logFileLevel,
  logToFile: config.logToFile,
  prettyPrint: config.logPretty,
});
interceptConsole();
initMessageLogger();

console.log(`[Config] Data dir: ${config.dataDir}`);
console.log(
  `[Config] Log file: ${getLogFilePath({ logDir: config.logDir, logFile: config.logFile })}`,
);

const claudeCli = detectClaudeCli();
if (claudeCli.found) {
  console.log(`Claude CLI found: ${claudeCli.path} (${claudeCli.version})`);
} else {
  console.warn("Warning: Claude CLI not found.");
}

const codexCli = await detectCodexCli();
if (codexCli.found) {
  console.log(`Codex CLI found: ${codexCli.path} (${codexCli.version})`);
} else {
  console.warn("Warning: Codex CLI not found.");
}

const realSdk = new RealClaudeSDK();
const eventBus = new EventBus();
const fileWatchers: FileWatcher[] = [];

function createWatcherIfExists(watchDir: string, provider: "claude" | "codex"): void {
  if (fs.existsSync(watchDir)) {
    const periodicRescanMs = provider === "codex" ? config.codexWatchPeriodicRescanMs : 0;

    const watcher = new FileWatcher({
      watchDir,
      provider,
      eventBus,
      debounceMs: 200,
      periodicRescanMs,
    });
    watcher.start();
    fileWatchers.push(watcher);
  } else {
    console.log(`[FileWatcher] Skipping ${provider} (${watchDir} not found)`);
  }
}

createWatcherIfExists(config.claudeSessionsDir, "claude");
createWatcherIfExists(config.codexSessionsDir, "codex");

const installService = new InstallService({
  dataDir: config.dataDir,
});
const serverSettingsService = new ServerSettingsService({
  dataDir: config.dataDir,
});
const projectMetadataService = new ProjectMetadataService({
  dataDir: config.dataDir,
});
const sessionMetadataService = new SessionMetadataService({
  dataDir: config.dataDir,
});
const notificationService = new NotificationService({
  dataDir: config.dataDir,
  eventBus,
});
const sessionIndexService = new SessionIndexService({
  dataDir: path.join(config.dataDir, "indexes"),
  projectsDir: config.claudeProjectsDir,
  eventBus,
});
const modelInfoService = new ModelInfoService();

async function startServer() {
  let tlsOptions: { key: Buffer; cert: Buffer } | undefined;
  if (config.httpsSelfSigned) {
    const certResult = ensureSelfSignedCertificate({
      dataDir: config.dataDir,
      host: config.host,
    });
    tlsOptions = {
      key: certResult.key,
      cert: certResult.cert,
    };
    console.log(
      `[HTTPS] ${certResult.generated ? "Generated" : "Using existing"} self-signed certificate at ${certResult.certPath}`,
    );
  }
  const serverProtocol = tlsOptions ? "https" : "http";

  await installService.initialize();
  await serverSettingsService.initialize();
  await projectMetadataService.initialize();
  await sessionMetadataService.initialize();
  await notificationService.initialize();
  await sessionIndexService.initialize();

  modelInfoService.warmProvider("claude").catch(() => {});
  modelInfoService.warmProvider("codex").catch(() => {});

  const { app, supervisor, scanner } = createApp({
    realSdk,
    projectsDir: config.claudeProjectsDir,
    idleTimeoutMs: config.idleTimeoutMs,
    defaultPermissionMode: config.defaultPermissionMode,
    eventBus,
    projectScanCacheTtlMs: config.projectScanCacheTtlMs,
    maxWorkers: config.maxWorkers,
    idlePreemptThresholdMs: config.idlePreemptThresholdMs,
    maxQueueSize: config.maxQueueSize,
    serverSettingsService,
    modelInfoService,
    enabledProviders: config.enabledProviders,
    installId: installService.getInstallId(),
    voiceInputEnabled: config.voiceInputEnabled,
    projectMetadataService,
    sessionMetadataService,
    notificationService,
    sessionIndexService,
    frontendDistPath: config.clientDistDir,
  });

  supervisorForShutdown = supervisor;

  const { wss, upgradeWebSocket } = createNodeWebSocket({ app });
  app.route(
    "/api",
    createUploadRoutes({
      scanner,
      upgradeWebSocket,
      maxUploadSizeBytes: config.maxUploadSizeBytes,
    }),
  );

  const server = tlsOptions
    ? serve(
        {
          fetch: app.fetch,
          port: config.port,
          hostname: config.host,
          createServer: createHttpsServer,
          serverOptions: tlsOptions,
        },
        ({ port }) => {
          console.log(`Server running at ${serverProtocol}://${config.host}:${port}`);
        },
      )
    : serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
        console.log(`Server running at http://${config.host}:${port}`);
      });

  attachUnifiedUpgradeHandler(server, {
    frontendProxy: undefined,
    isApiPath: (urlPath) => urlPath.startsWith("/api"),
    app,
    wss,
  });

  server.on("error", (error: unknown) => {
    const err = error as NodeJS.ErrnoException;
    console.error(
      `[Server] Failed to bind ${serverProtocol}://${config.host}:${config.port}: ${err.message ?? "Unknown error"}`,
    );
    if (err.code === "EADDRINUSE") {
      console.error(
        `[Server] Port ${config.port} is already in use. Stop the existing process or run with a different PORT.`,
      );
    }
    process.exit(1);
  });
}

await startServer();
