import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/app.js";
import { LibraryService, scholarSourceDir } from "../../src/services/LibraryService.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

const dataDir = await mkdtemp(path.join(tmpdir(), "hub-browser-test-"));
const library = new LibraryService(dataDir);
let application: ReturnType<typeof createApp> | undefined;
let server: ReturnType<typeof serve> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server?.close();
  await application?.close();
  await library.close();
  await rm(dataDir, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void close().then(() => process.exit());
  });
try {
  const setup = spawnSync(
    process.env.SCHOLARAIO_HUB_UV ?? "uv",
    ["sync", "--project", scholarSourceDir, "--locked", "--extra", "hub", "--no-default-groups"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: path.join(dataDir, "runtime/python"),
        UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "hub-test-uv-cache"),
      },
    },
  );
  if (setup.status !== 0)
    throw setup.error ?? new Error("Cannot prepare isolated Python test environment; install uv");
  await library.start();
  application = createApp({
    dataDir,
    libraryService: library,
    provider: new WorkbenchProvider(),
    frontendDistPath: path.resolve("../client/dist"),
  });
  await application.ready;
  server = serve({
    fetch: application.app.fetch,
    port: Number(process.env.PORT),
    hostname: "127.0.0.1",
  });
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
