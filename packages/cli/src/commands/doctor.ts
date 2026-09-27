import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeCapabilities } from "../install.js";
import { currentProfile } from "../profile.js";
import { pythonRuntime } from "../python.js";

const serverDir = fileURLToPath(new URL("../../../server/", import.meta.url));
const clientDist = fileURLToPath(new URL("../../../client/dist/", import.meta.url));

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/** Whether a port in use is this profile's own running Hub: it names the same data directory. */
async function ownHub(host: string, port: number, dataDir: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return ((await response.json()) as { data?: { dataDir?: string } }).data?.dataDir === dataDir;
  } catch (error) {
    console.log(
      "Cannot identify the process using the HTTP port:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Check the data directory, the ports, the Python runtime and the client build,
 * then the AI CLIs, which the server itself checks (`server/src/doctor.ts`).
 */
export async function doctor(): Promise<number> {
  const profile = currentProfile();
  const host = process.env.HOST || "127.0.0.1";
  console.log(
    `Profile: ${profile.name}\nData directory: ${profile.dataDir}\nHTTP port: ${profile.port}\nLibrary port: ${profile.libraryPort}`,
  );
  let writable = false;
  try {
    let parent = profile.dataDir;
    while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    await access(parent, constants.W_OK);
    writable = true;
  } catch (error) {
    console.error("Data directory is not writable:", error);
  }
  console.log(`Data directory writable: ${writable}`);
  const hubFree = await portIsFree(profile.port, host);
  const running = !hubFree && (await ownHub(host, profile.port, profile.dataDir));
  const libraryFree = await portIsFree(profile.libraryPort, host);
  console.log(
    `HTTP port ready: ${hubFree || running}${running ? " (application is running)" : ""}`,
  );
  console.log(`Library port ready: ${libraryFree || running}`);
  const runtime = pythonRuntime(profile.dataDir);
  const python = spawnSync(
    runtime.executable,
    ["-c", "import scholaraio, fastapi, pymupdf; print('Python library: ready')"],
    { encoding: "utf8", timeout: 10000, env: runtime.env() },
  );
  console.log((python.stdout || python.error?.message || python.stderr).trim());
  if (python.status === 0)
    console.log(
      `Python capabilities: core${runtimeCapabilities(profile.dataDir)
        .map((item) => ` + ${item}`)
        .join("")}`,
    );
  // Production serves the built client; development gets it from Vite.
  const clientBuilt = existsSync(
    path.join(process.env.CLIENT_DIST_DIR ?? clientDist, "index.html"),
  );
  if (profile.nodeEnv === "production")
    console.log(`Client build: ${clientBuilt ? "present" : "missing; run pnpm build"}`);
  const tsx = createRequire(path.join(serverDir, "package.json")).resolve("tsx/cli");
  const providers = spawnSync(
    process.execPath,
    [tsx, "--conditions", "scholaraio-source", "src/doctor.ts"],
    { cwd: serverDir, stdio: "inherit" },
  );
  return writable &&
    (hubFree || running) &&
    (libraryFree || running) &&
    (clientBuilt || profile.nodeEnv !== "production") &&
    python.status === 0 &&
    providers.status === 0
    ? 0
    : 1;
}
