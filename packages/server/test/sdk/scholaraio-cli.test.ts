import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLibraryDataDir, withScholaraioCli } from "../../src/sdk/providers/scholaraio-cli.js";

const executable = process.platform === "win32" ? "scholaraio.exe" : "scholaraio";
const binDirName = process.platform === "win32" ? "Scripts" : "bin";

function dataDir(options: { config?: boolean; cli?: boolean }): string {
  const root = mkdtempSync(path.join(tmpdir(), "scholaraio-cli-env-"));
  if (options.config) writeFileSync(path.join(root, "config.yaml"), "# test\n");
  if (options.cli) {
    const binDir = path.join(root, "runtime", "python", binDirName);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, executable), "");
  }
  return root;
}

describe("withScholaraioCli", () => {
  it("points the agent CLI at the application library", () => {
    const root = dataDir({ config: true, cli: true });
    const env = withScholaraioCli({ PATH: "/usr/bin" }, root);
    const binDir = path.join(root, "runtime", "python", binDirName);
    expect(env.SCHOLARAIO_CONFIG).toBe(path.join(root, "config.yaml"));
    expect(env.PATH).toBe(`${binDir}${path.delimiter}/usr/bin`);
  });

  it("keeps the application CLI ahead of any other installation", () => {
    const root = dataDir({ config: true, cli: true });
    const env = withScholaraioCli({ PATH: "/opt/other/bin" }, root);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(
      path.join(root, "runtime", "python", binDirName),
    );
  });

  it("follows the data directory the application was given", () => {
    const root = dataDir({ config: true, cli: true });
    setLibraryDataDir(root);
    expect(withScholaraioCli({ PATH: "/usr/bin" }).SCHOLARAIO_CONFIG).toBe(
      path.join(root, "config.yaml"),
    );
  });

  it("does not claim a library when the application config is missing", () => {
    const env = withScholaraioCli({ PATH: "/usr/bin" }, dataDir({ cli: true }));
    expect(env.SCHOLARAIO_CONFIG).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("still names the library when the runtime environment is not installed", () => {
    const root = dataDir({ config: true });
    const env = withScholaraioCli({ PATH: "/usr/bin" }, root);
    expect(env.SCHOLARAIO_CONFIG).toBe(path.join(root, "config.yaml"));
    expect(env.PATH).toBe("/usr/bin");
  });
});
