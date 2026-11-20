import { spawnSync } from "node:child_process";
import { libraryProject, withLibraryPython } from "./python-env.mjs";

process.exitCode = withLibraryPython(["hub", "hub-test"], (python) => {
  const result = spawnSync(
    python,
    [
      "-m",
      "pytest",
      "tests/test_hub_library.py",
      "tests/test_hub_mcp.py",
      "tests/test_mineru_tasks.py",
      "tests/test_hub_bundles.py",
      "tests/test_hub_lifecycle.py",
      "tests/test_hub_access.py",
      "tests/test_hub_runtime_install.py",
      "tests/test_hub_migration.py",
      "tests/test_hub_cli_routing.py",
      "tests/test_hub_import.py",
      "tests/test_hub_tasks.py",
      "tests/test_hub_settings.py",
      "tests/test_hub_embedding_api.py",
      "tests/test_hub_acquire.py",
      "tests/test_hub_discover.py",
      "tests/test_hub_export.py",
      "tests/test_hub_events.py",
      "tests/test_hub_api_contract.py",
      "tests/test_hub_openapi.py",
      "tests/test_hub_layers.py",
      "tests/test_ingest_pipeline.py",
      "tests/test_chunks.py",
      "tests/test_papers.py",
      "tests/test_index.py",
      "-q",
    ],
    { cwd: libraryProject, stdio: "inherit" },
  );
  return result.status ?? 1;
});
