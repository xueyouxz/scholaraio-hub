import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type PythonRuntime, pythonRuntime, scholarSourceDir } from "./python.js";

/**
 * What a data directory's Python runtime can do beyond the core library.
 *
 * `uv sync` makes the environment match exactly the extras it is given and
 * removes everything else, so whoever syncs must name every capability the
 * data directory already has, not only the one being added.
 */
export type Capability = "semantic";

/** The library service and MinerU's cloud CLI, which PDF parsing uses. */
const CORE_EXTRAS = ["hub", "mineru-cloud"];

const CAPABILITY_EXTRAS: Record<Capability, readonly string[]> = {
  // topics pulls embed with it: one environment serves both.
  semantic: ["topics"],
};

const CAPABILITIES = Object.keys(CAPABILITY_EXTRAS) as Capability[];

interface RuntimeManifest {
  version: 1;
  capabilities: Capability[];
}

export function uvExecutable(env: Record<string, string | undefined> = process.env): string {
  return env.SCHOLARAIO_HUB_UV ?? "uv";
}

export const UV_MISSING_HINT =
  "需要 uv，请安装 https://docs.astral.sh/uv/getting-started/installation/";

/** `uv sync` of the ScholarAIO project into an environment, with exactly these extras. */
export function uvSyncCommand(
  environment: string,
  cacheDir: string,
  extras: readonly string[],
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return {
    command: uvExecutable(),
    args: [
      "sync",
      "--project",
      scholarSourceDir,
      "--locked",
      ...extras.flatMap((extra) => ["--extra", extra]),
      "--no-default-groups",
    ],
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: environment, UV_CACHE_DIR: cacheDir },
  };
}

function manifestPath(runtime: PythonRuntime): string {
  return path.join(path.dirname(runtime.root), "manifest.json");
}

/** The capabilities recorded for this data directory, or undefined before the first record. */
function readManifest(runtime: PythonRuntime): Capability[] | undefined {
  const file = manifestPath(runtime);
  if (!existsSync(file)) return undefined;
  // An unreadable record must stop the sync: treating it as empty would uninstall.
  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as RuntimeManifest;
  } catch (error) {
    throw new Error(`无法读取运行环境清单 ${file}：${(error as Error).message}`);
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.capabilities))
    throw new Error(`运行环境清单格式不对：${file}`);
  const unknown = manifest.capabilities.filter((item) => !CAPABILITIES.includes(item));
  if (unknown.length) throw new Error(`运行环境清单含未知能力 ${unknown.join(", ")}：${file}`);
  return manifest.capabilities;
}

function writeManifest(runtime: PythonRuntime, capabilities: readonly Capability[]): void {
  const file = manifestPath(runtime);
  mkdirSync(path.dirname(file), { recursive: true });
  const manifest: RuntimeManifest = { version: 1, capabilities: [...capabilities].sort() };
  writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

/**
 * Environments set up before the manifest existed: read what is installed,
 * once, so the first sync keeps it.
 */
function detectCapabilities(runtime: PythonRuntime): Capability[] {
  if (!existsSync(runtime.executable)) return [];
  const probe = spawnSync(
    runtime.executable,
    [
      "-c",
      "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('sentence_transformers') else 3)",
    ],
    { env: runtime.env(), stdio: "ignore", timeout: 30_000 },
  );
  if (probe.status === 0) return ["semantic"];
  if (probe.status === 3) return [];
  throw new Error(
    `无法检查已安装的 Python 依赖（${probe.error?.message ?? `exit ${probe.status}`}）`,
  );
}

/** What the data directory's runtime has now: its manifest, or what is installed. */
export function runtimeCapabilities(dataDir: string): Capability[] {
  const runtime = pythonRuntime(dataDir);
  return readManifest(runtime) ?? detectCapabilities(runtime);
}

export interface RuntimeSync {
  /** Every capability the environment will have after the sync. */
  capabilities: Capability[];
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Record the capabilities; call only after the sync succeeded. */
  commit(): void;
}

/**
 * The one way to install a data directory's Python runtime. It keeps every
 * capability the runtime already has and adds `add`, so a later setup never
 * removes what an earlier install put there.
 */
export function planRuntimeSync(dataDir: string, add: readonly Capability[] = []): RuntimeSync {
  const runtime = pythonRuntime(dataDir);
  const current = runtimeCapabilities(dataDir);
  const capabilities = CAPABILITIES.filter((item) => add.includes(item) || current.includes(item));
  const extras = [...CORE_EXTRAS, ...capabilities.flatMap((item) => CAPABILITY_EXTRAS[item])];
  return {
    capabilities,
    ...uvSyncCommand(runtime.root, runtime.uvCacheDir, extras),
    commit: () => writeManifest(runtime, capabilities),
  };
}
