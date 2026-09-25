// A throwaway Python environment for the library package, synced from its lock
// file, for the scripts that run its code outside a Hub profile (the Python
// tests, the OpenAPI document). `SCHOLARAIO_HUB_UV` names a uv binary other
// than the one on PATH.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const libraryProject = fileURLToPath(new URL("../packages/scholaraio/", import.meta.url));

/** Sync an environment with these extras, hand `run` its Python, then delete it. */
export function withLibraryPython(extras, run) {
  const root = mkdtempSync(path.join(tmpdir(), "hub-python-"));
  try {
    const environment = path.join(root, "python");
    const setup = spawnSync(
      process.env.SCHOLARAIO_HUB_UV ?? "uv",
      [
        "sync",
        "--project",
        libraryProject,
        "--locked",
        ...extras.flatMap((extra) => ["--extra", extra]),
        "--no-default-groups",
      ],
      {
        // Progress goes to stderr, so a caller's stdout stays its own.
        stdio: ["ignore", process.stderr, "inherit"],
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: environment,
          UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "hub-test-uv-cache"),
        },
      },
    );
    if (setup.status !== 0)
      throw setup.error ?? new Error("Install uv to run the library's Python");
    return run(
      path.join(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
