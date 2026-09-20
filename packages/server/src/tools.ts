import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { detectCodexCli } from "./sdk/cli-detection.js";
import { libraryPythonPath, scholarSourceDir } from "./services/LibraryService.js";

const config = loadConfig();
const command = process.argv[2];
const uv = process.env.SCHOLARAIO_HUB_UV ?? "uv";
if (command === "setup") {
  mkdirSync(config.dataDir, { recursive: true });
  const result = spawnSync(
    uv,
    ["sync", "--project", scholarSourceDir, "--locked", "--extra", "hub", "--no-default-groups"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        UV_PROJECT_ENVIRONMENT: `${config.dataDir}/runtime/python`,
        UV_CACHE_DIR: `${config.dataDir}/data/cache/uv`,
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
  const python = spawnSync(
    libraryPythonPath(config.dataDir),
    ["-c", "import scholaraio, fastapi, pymupdf; print('Python library: ready')"],
    { encoding: "utf8" },
  );
  console.log(python.stdout || python.error?.message || python.stderr);
  const codex = await detectCodexCli();
  console.log(`Codex: ${codex.found ? codex.path : codex.error}`);
  const claude = spawnSync("claude", ["auth", "status"], { encoding: "utf8", timeout: 10000 });
  console.log(
    `Claude login: ${claude.status === 0 ? "ready" : "unavailable; run claude auth login"}`,
  );
  const codexAuth = codex.path
    ? spawnSync(codex.path, ["login", "status"], { encoding: "utf8", timeout: 10000 })
    : undefined;
  console.log(`Codex login: ${codexAuth?.status === 0 ? "ready" : "unavailable; run codex login"}`);
  process.exitCode = python.status === 0 ? 0 : 1;
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
