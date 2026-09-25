import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { loadConfig } from "../config.js";
import {
  claudeProvider,
  resolveLocalClaudeCodeExecutable,
} from "../providers/claude/ClaudeProvider.js";
import { codexProvider } from "../providers/codex/CodexProvider.js";
import { findCodexCli } from "../providers/codex/cli.js";
import { runtimeCapabilities } from "../runtime/install.js";
import { pythonRuntime } from "../runtime/python.js";

/** Check the data directory, port, Python runtime and the AI CLIs' local logins. */
export async function doctor(): Promise<number> {
  const config = loadConfig();
  console.log(
    `Profile: ${config.profile}\nData directory: ${config.dataDir}\nHTTP port: ${config.port}`,
  );
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
      const response = await fetch(`http://${config.host}:${config.port}/api/status`, {
        signal: AbortSignal.timeout(2000),
      });
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
  if (python.status === 0)
    console.log(
      `Python capabilities: core${runtimeCapabilities(config.dataDir)
        .map((item) => ` + ${item}`)
        .join("")}`,
    );
  // Production serves the built client; development gets it from Vite.
  const clientBuilt = existsSync(path.join(config.clientDistDir, "index.html"));
  if (config.nodeEnv === "production")
    console.log(`Client build: ${clientBuilt ? "present" : "missing; run pnpm build"}`);
  const codex = await findCodexCli();
  console.log(
    `Codex: ${codex ? `${codex.path} (${codex.version})` : "Codex CLI cannot run. Repair with: npm install -g @openai/codex"}`,
  );
  const claudePath = resolveLocalClaudeCodeExecutable();
  const claude = claudePath
    ? spawnSync(claudePath, ["--version"], { encoding: "utf8", timeout: 10000 })
    : undefined;
  console.log(`Claude: ${claude?.status === 0 ? claude.stdout.trim() : "not executable"}`);
  // The providers decide what counts as logged in; the doctor asks them the same way the app does.
  const [claudeAuth, codexAuth] = await Promise.all([
    claudeProvider.getAuthStatus(),
    codexProvider.getAuthStatus(),
  ]);
  console.log(
    `Claude local login: ${claudeAuth.authenticated ? "present" : "unavailable; run claude auth login"}`,
  );
  console.log(
    `Codex local login: ${codexAuth.authenticated ? "present" : "unavailable; run codex login"}`,
  );
  console.log("Local login does not prove that a remote token has not expired or been revoked.");
  return writable &&
    (portAvailable || ownServer) &&
    (clientBuilt || config.nodeEnv !== "production") &&
    python.status === 0 &&
    (claudeAuth.authenticated || codexAuth.authenticated)
    ? 0
    : 1;
}
