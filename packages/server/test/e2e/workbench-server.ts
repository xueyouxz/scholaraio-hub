import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { resolveLibraryPort } from "@scholaraio-hub/shared";
// The launcher's own pieces: this fixture stands in for `pnpm start` with fake agents.
import { uvSyncCommand } from "../../../cli/src/install.js";
import { LibraryProcess } from "../../../cli/src/library-process.js";
import { pythonRuntime } from "../../../cli/src/python.js";
import { createApp } from "../../src/app.js";
import { type Services, createServices } from "../../src/container.js";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { ProviderRegistry } from "../../src/providers/ProviderRegistry.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

const dataDir = await mkdtemp(path.join(tmpdir(), "hub-browser-test-"));
// Browser tests must not depend on Crossref, Semantic Scholar or OpenAlex:
// imports keep what the file itself states and mark the identifiers as missing.
process.env.SCHOLARAIO_HUB_NO_API = "1";
const port = Number(process.env.PORT);
const library = new LibraryProcess({
  dataDir,
  host: "127.0.0.1",
  port: resolveLibraryPort({ PORT: String(port) }),
  hubPort: port,
});
let services: Services | undefined;
let server: ReturnType<typeof serve> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server?.close();
  await services?.close();
  await library.stop();
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
  const skillsDir = path.join(dataDir, "skills");
  await mkdir(path.join(skillsDir, "review-fixture"), { recursive: true });
  await writeFile(
    path.join(skillsDir, "review-fixture", "SKILL.md"),
    "---\nname: review-fixture\ndescription: 用于隔离测试的科研技能\n---\n阅读研究资料并总结 $ARGUMENTS",
  );
  // Both tool choices are deterministic fakes: browser tests never launch a real CLI.
  services = createServices({
    dataDir,
    library: new LibraryClient(library.url),
    providers: new ProviderRegistry([
      new WorkbenchProvider("claude"),
      new WorkbenchProvider("codex"),
    ]),
    skillsDir,
  });
  await services.start();
  const app = createApp(services, { frontendDistPath: path.resolve("../client/dist") });
  server = serve({
    fetch: app.fetch,
    port,
    hostname: "127.0.0.1",
  });
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
