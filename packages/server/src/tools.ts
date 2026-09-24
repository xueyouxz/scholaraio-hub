import { spawnSync } from "node:child_process";
import { constants, existsSync, mkdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { loadConfig } from "./config.js";
import { pythonRuntime, scholarSourceDir } from "./runtime/python.js";
import { detectCodexCli } from "./sdk/cli-detection.js";
import { resolveLocalClaudeCodeExecutable } from "./sdk/providers/claude.js";

const config = loadConfig();
const command = process.argv[2];
const uv = process.env.SCHOLARAIO_HUB_UV ?? "uv";
if (command === "setup") {
  mkdirSync(config.dataDir, { recursive: true });
  const result = spawnSync(
    uv,
    [
      "sync",
      "--project",
      scholarSourceDir,
      "--locked",
      "--extra",
      "hub",
      // PDF parsing runs on MinerU's cloud service, which needs its CLI.
      "--extra",
      "mineru-cloud",
      "--no-default-groups",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: pythonRuntime(config.dataDir).root,
        UV_CACHE_DIR: pythonRuntime(config.dataDir).uvCacheDir,
      },
    },
  );
  if (result.error)
    console.error(
      "需要 uv，请安装 https://docs.astral.sh/uv/getting-started/installation/",
      result.error.message,
    );
  process.exitCode = result.status ?? 1;
} else if (command === "doctor") {
  console.log(`Data directory: ${config.dataDir}\nHTTP port: ${config.port}`);
  let writable = false;
  try {
    let parent = config.dataDir;
    while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    await access(parent, constants.W_OK);
    writable = true;
  } catch (error) {
    console.error("Data directory is not writable:", error);
  }
  console.log(`Data directory writable: ${writable}`);
  const portAvailable = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", (error) => {
      console.log(`HTTP port: ${error.message}`);
      resolve(false);
    });
    probe.listen(config.port, config.host, () => probe.close(() => resolve(true)));
  });
  let ownServer = false;
  if (!portAvailable) {
    try {
      const response = await fetch(
        `${config.httpsSelfSigned ? "https" : "http"}://${config.host}:${config.port}/api/status`,
        { signal: AbortSignal.timeout(2000) },
      );
      const status = (await response.json()) as { dataDir?: string };
      ownServer = status.dataDir === config.dataDir;
    } catch (error) {
      console.log(
        "Cannot identify process using HTTP port:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  console.log(
    `HTTP port ready: ${portAvailable || ownServer}${ownServer ? " (application is running)" : ""}`,
  );
  const runtime = pythonRuntime(config.dataDir);
  const python = spawnSync(
    runtime.executable,
    ["-c", "import scholaraio, fastapi, pymupdf; print('Python library: ready')"],
    { encoding: "utf8", timeout: 10000, env: runtime.env() },
  );
  console.log(python.stdout || python.error?.message || python.stderr);
  const codex = await detectCodexCli();
  console.log(`Codex: ${codex.found ? `${codex.path} (${codex.version})` : codex.error}`);
  const claudePath = resolveLocalClaudeCodeExecutable();
  const claude = claudePath
    ? spawnSync(claudePath, ["--version"], { encoding: "utf8", timeout: 10000 })
    : undefined;
  console.log(`Claude: ${claude?.status === 0 ? claude.stdout.trim() : "not executable"}`);
  const claudeAuth =
    claude?.status === 0 && claudePath
      ? spawnSync(claudePath, ["auth", "status"], { encoding: "utf8", timeout: 10000 })
      : undefined;
  let claudeLoggedIn = false;
  if (claudeAuth?.status === 0) {
    try {
      claudeLoggedIn = JSON.parse(claudeAuth.stdout).loggedIn === true;
    } catch (error) {
      console.error("Cannot parse Claude auth status:", error);
    }
  }
  const codexAuth = codex.path
    ? spawnSync(codex.path, ["login", "status"], { encoding: "utf8", timeout: 10000 })
    : undefined;
  console.log(
    `Claude local login: ${claudeLoggedIn ? "present" : "unavailable; run claude auth login"}`,
  );
  console.log(
    `Codex local login: ${codexAuth?.status === 0 ? "present" : "unavailable; run codex login"}`,
  );
  console.log("Local login does not prove that a remote token has not expired or been revoked.");
  process.exitCode =
    writable &&
    (portAvailable || ownServer) &&
    python.status === 0 &&
    (claudeLoggedIn || codexAuth?.status === 0)
      ? 0
      : 1;
} else if (command === "migrate") {
  const args = process.argv.slice(3).filter((arg) => arg !== "--production");
  const runtime = pythonRuntime(config.dataDir);
  const result = spawnSync(runtime.executable, ["-m", "scholaraio.hub.migration", ...args], {
    stdio: "inherit",
    cwd: scholarSourceDir,
    env: runtime.env(),
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
