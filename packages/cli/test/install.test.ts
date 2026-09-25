import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planRuntimeSync, runtimeCapabilities, uvSyncCommand } from "../src/install.js";
import { pythonRuntime } from "../src/python.js";

function dataDir(manifest?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "hub-runtime-install-"));
  if (manifest !== undefined) {
    mkdirSync(path.join(root, "runtime"), { recursive: true });
    writeFileSync(path.join(root, "runtime", "manifest.json"), manifest);
  }
  return root;
}

/** A stand-in interpreter that answers the capability probe with `code`. */
function fakePython(root: string, code: number): void {
  const executable = pythonRuntime(root).executable;
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, `#!/bin/sh\nexit ${code}\n`);
  chmodSync(executable, 0o755);
}

function extras(args: string[]): string[] {
  return args.flatMap((arg, index) => (args[index - 1] === "--extra" ? [arg] : []));
}

afterEach(() => vi.unstubAllEnvs());

describe("uvSyncCommand", () => {
  it("syncs the ScholarAIO project into the given environment", () => {
    vi.stubEnv("SCHOLARAIO_HUB_UV", "/opt/uv");
    const sync = uvSyncCommand("/env", "/cache", ["hub", "hub-test"]);
    expect(sync.command).toBe("/opt/uv");
    expect(sync.args.slice(0, 2)).toEqual(["sync", "--project"]);
    expect(sync.args).toContain("--locked");
    expect(extras(sync.args)).toEqual(["hub", "hub-test"]);
    expect(sync.env.UV_PROJECT_ENVIRONMENT).toBe("/env");
    expect(sync.env.UV_CACHE_DIR).toBe("/cache");
  });
});

describe("planRuntimeSync", () => {
  it("installs only the core on a fresh data directory", () => {
    const sync = planRuntimeSync(dataDir());
    expect(sync.capabilities).toEqual([]);
    expect(extras(sync.args)).toEqual(["hub", "mineru-cloud"]);
  });

  it("keeps the capabilities the manifest records", () => {
    const sync = planRuntimeSync(dataDir('{"version":1,"capabilities":["semantic"]}'));
    expect(sync.capabilities).toEqual(["semantic"]);
    expect(extras(sync.args)).toEqual(["hub", "mineru-cloud", "topics"]);
  });

  it("adds a requested capability and records it once the sync succeeds", () => {
    const root = dataDir();
    const sync = planRuntimeSync(root, ["semantic"]);
    expect(extras(sync.args)).toContain("topics");
    expect(runtimeCapabilities(root)).toEqual([]);
    sync.commit();
    expect(JSON.parse(readFileSync(path.join(root, "runtime", "manifest.json"), "utf8"))).toEqual({
      version: 1,
      capabilities: ["semantic"],
    });
    expect(extras(planRuntimeSync(root).args)).toContain("topics");
  });

  it("refuses to sync over a manifest it cannot read", () => {
    expect(() => planRuntimeSync(dataDir("{not json"))).toThrow(/无法读取运行环境清单/);
    expect(() => planRuntimeSync(dataDir('{"version":1,"capabilities":["gpu"]}'))).toThrow(
      /未知能力 gpu/,
    );
  });

  it.skipIf(process.platform === "win32")(
    "reads what an environment from before the manifest has installed",
    () => {
      const withEmbeddings = dataDir();
      fakePython(withEmbeddings, 0);
      expect(planRuntimeSync(withEmbeddings).capabilities).toEqual(["semantic"]);

      const withoutEmbeddings = dataDir();
      fakePython(withoutEmbeddings, 3);
      expect(planRuntimeSync(withoutEmbeddings).capabilities).toEqual([]);

      const broken = dataDir();
      fakePython(broken, 1);
      expect(() => planRuntimeSync(broken)).toThrow(/无法检查已安装的 Python 依赖/);
    },
  );
});
