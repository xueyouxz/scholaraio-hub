import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../packages/scholaraio/", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "hub-python-tests-"));
try {
  const environment = path.join(root, "python");
  const setup = spawnSync(
    process.env.SCHOLARAIO_HUB_UV ?? "uv",
    [
      "sync",
      "--project",
      project,
      "--locked",
      "--extra",
      "hub",
      "--extra",
      "hub-test",
      "--no-default-groups",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: environment,
        UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "hub-test-uv-cache"),
      },
    },
  );
  if (setup.status !== 0) throw setup.error ?? new Error("Install uv before running Python tests");
  const result = spawnSync(
    path.join(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    [
      "-m",
      "pytest",
      "tests/test_hub_library.py",
      "tests/test_hub_lifecycle.py",
      "tests/test_hub_migration.py",
      "tests/test_hub_cli_routing.py",
      "tests/test_hub_import.py",
      "tests/test_hub_tasks.py",
      "tests/test_hub_settings.py",
      "tests/test_ingest_pipeline.py",
      "tests/test_chunks.py",
      "tests/test_papers.py",
      "tests/test_index.py",
      "-q",
    ],
    { cwd: project, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
