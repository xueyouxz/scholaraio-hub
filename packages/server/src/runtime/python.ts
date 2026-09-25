import path from "node:path";
import { fileURLToPath } from "node:url";

/** The ScholarAIO Python project in this checkout; `uv sync` installs it into the runtime. */
export const scholaraioSourceDir = fileURLToPath(new URL("../../../scholaraio/", import.meta.url));

type Env = Record<string, string | undefined>;

export interface PythonRuntime {
  /** The virtual environment `uv sync` installs into (its `UV_PROJECT_ENVIRONMENT`). */
  root: string;
  /** uv's download cache, kept with the data so reinstalls stay offline-friendly. */
  uvCacheDir: string;
  /** Where the environment's interpreter and console scripts live. */
  binDir: string;
  /** The environment's interpreter. */
  executable: string;
  /** A console script installed into the environment, such as `scholaraio`. */
  command(name: string): string;
  /**
   * `base` with the environment activated. Running the interpreter by path does
   * not activate it, so without this the scripts installed beside it
   * (`mineru-open-api`, `scholaraio`) are not on PATH for anything it starts.
   */
  env(base?: Env): Env;
}

/** The single description of where a data directory keeps its Python runtime. */
export function pythonRuntime(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
): PythonRuntime {
  const windows = platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const delimiter = windows ? path.win32.delimiter : path.posix.delimiter;
  const root = join(dataDir, "runtime", "python");
  const binDir = join(root, windows ? "Scripts" : "bin");
  return {
    root,
    uvCacheDir: join(dataDir, "data", "cache", "uv"),
    binDir,
    executable: join(binDir, windows ? "python.exe" : "python"),
    command: (name) => join(binDir, windows ? `${name}.exe` : name),
    env(base = process.env) {
      // Windows spells it Path; keep whichever spelling the caller already uses.
      const pathKey = Object.keys(base).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
      // PYTHONHOME would point the interpreter at another installation's stdlib.
      const result: Env = { ...base, VIRTUAL_ENV: root, PYTHONHOME: undefined };
      result[pathKey] = [binDir, base[pathKey]].filter(Boolean).join(delimiter);
      return result;
    },
  };
}
