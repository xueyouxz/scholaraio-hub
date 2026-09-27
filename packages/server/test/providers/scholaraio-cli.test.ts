import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentEnv, withScholaraioCli } from "../../src/providers/agent-env.js";

const executable = process.platform === "win32" ? "scholaraio.exe" : "scholaraio";
const binDirName = process.platform === "win32" ? "Scripts" : "bin";

/** A data directory as the launcher describes it to the server. */
function library(options: { config?: boolean; cli?: boolean }) {
  const root = dataDir(options);
  return {
    configFile: path.join(root, "config.yaml"),
    cliBinDir: path.join(root, "runtime", "python", binDirName),
  };
}

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
    const described = library({ config: true, cli: true });
    const env = withScholaraioCli({ PATH: "/usr/bin" }, described);
    expect(env.SCHOLARAIO_CONFIG).toBe(described.configFile);
    expect(env.PATH).toBe(`${described.cliBinDir}${path.delimiter}/usr/bin`);
  });

  it("keeps the application CLI ahead of any other installation", () => {
    const described = library({ config: true, cli: true });
    const env = withScholaraioCli({ PATH: "/opt/other/bin" }, described);
    expect(env.PATH?.split(path.delimiter)[0]).toBe(described.cliBinDir);
  });

  it("gives an agent the library it was built with, and the service its writes go to", () => {
    const described = library({ config: true, cli: true });
    const env = agentEnv({ ...described, libraryUrl: "http://127.0.0.1:3601" });
    expect(env.SCHOLARAIO_CONFIG).toBe(described.configFile);
    expect(env.SCHOLARAIO_LIBRARY_API).toBe("http://127.0.0.1:3601");
  });

  it("leaves the environment alone when no library is bound", () => {
    expect(withScholaraioCli({ PATH: "/usr/bin" }, undefined)).toEqual({ PATH: "/usr/bin" });
  });

  it("does not claim a library when the application config is missing", () => {
    const env = withScholaraioCli({ PATH: "/usr/bin" }, library({ cli: true }));
    expect(env.SCHOLARAIO_CONFIG).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("still names the library when the runtime environment is not installed", () => {
    const described = library({ config: true });
    const env = withScholaraioCli({ PATH: "/usr/bin" }, described);
    expect(env.SCHOLARAIO_CONFIG).toBe(described.configFile);
    expect(env.PATH).toBe("/usr/bin");
  });
});
