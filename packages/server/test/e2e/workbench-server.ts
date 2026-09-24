import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/app.js";
import { uvSyncCommand } from "../../src/runtime/install.js";
import { pythonRuntime } from "../../src/runtime/python.js";
import { claudeProvider, codexProvider } from "../../src/sdk/providers/index.js";
import { LibraryService } from "../../src/services/LibraryService.js";
import { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

// Keep both tool choices deterministic; never launch a real CLI from browser tests.
for (const provider of [claudeProvider, codexProvider]) {
  const fake = new WorkbenchProvider(provider.name);
  provider.startSession = fake.startSession.bind(fake);
  provider.getAuthStatus = fake.getAuthStatus.bind(fake);
  provider.getAvailableModels = fake.getAvailableModels.bind(fake);
}

const dataDir = await mkdtemp(path.join(tmpdir(), "hub-browser-test-"));
// Browser tests must not depend on Crossref, Semantic Scholar or OpenAlex:
// imports keep what the file itself states and mark the identifiers as missing.
process.env.SCHOLARAIO_HUB_NO_API = "1";
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
  // Only the library service: browser tests never parse PDFs through MinerU.
  const sync = uvSyncCommand(
    pythonRuntime(dataDir).root,
    process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "hub-test-uv-cache"),
    ["hub"],
  );
  const setup = spawnSync(sync.command, sync.args, { stdio: "inherit", env: sync.env });
  if (setup.status !== 0)
    throw setup.error ?? new Error("Cannot prepare isolated Python test environment; install uv");
  await library.start();
  const settings = new ServerSettingsService({ dataDir });
  await settings.initialize();
  const skillsDir = path.join(dataDir, "skills");
  await mkdir(path.join(skillsDir, "review-fixture"), { recursive: true });
  await writeFile(
    path.join(skillsDir, "review-fixture", "SKILL.md"),
    "---\nname: review-fixture\ndescription: 用于隔离测试的科研技能\n---\n阅读研究资料并总结 $ARGUMENTS",
  );
  application = createApp({
    scholaraioSkillsDir: skillsDir,
    serverSettingsService: settings,
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
