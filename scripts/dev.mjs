import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local from repo root so SCHOLARAIO_CONFIG (and others) can be
// forwarded to the scholaraio serve child process without requiring shell-level exports.
function loadDotenvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return {};

  const vars = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    vars[key] = val;
  }
  return vars;
}

const dotenvLocal = loadDotenvLocal();

// Merge .env.local into the inherited env, giving precedence to already-set
// shell vars so explicit exports always win over the file.
const scholarEnv = { ...process.env };
for (const [k, v] of Object.entries(dotenvLocal)) {
  if (scholarEnv[k] === undefined) scholarEnv[k] = v;
}

const children = [];

function spawnChild(cmd, args, label, opts = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.warn(`[${label}] command not found — skipping`);
    } else {
      console.error(`[${label}] error: ${err.message}`);
    }
  });

  children.push(child);
  return child;
}

spawnChild("scholaraio", ["serve"], "scholaraio", { env: scholarEnv });

const hub = spawnChild(
  "pnpm",
  [
    "-r",
    "--parallel",
    "--stream",
    "--filter",
    "@scholaraio-hub/server",
    "--filter",
    "@scholaraio-hub/client",
    "dev",
  ],
  "hub",
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const child of children) {
      if (!child.killed) child.kill(sig);
    }
  });
}

hub.on("exit", (code) => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code ?? 0);
});
