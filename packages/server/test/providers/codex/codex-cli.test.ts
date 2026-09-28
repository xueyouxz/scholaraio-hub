import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareCodexVersions,
  findCodexCli,
  resolveCodexCli,
} from "../../../src/providers/codex/cli.js";

describe("compareCodexVersions", () => {
  it("orders `codex --version` outputs by semver, pre-releases before their release", () => {
    expect(compareCodexVersions("codex-cli 0.155.1", "codex-cli 0.142.5")).toBeGreaterThan(0);
    expect(compareCodexVersions("codex-cli 0.142.5", "codex-cli 0.155.1")).toBeLessThan(0);
    expect(compareCodexVersions("codex-cli 0.158.0-alpha.2", "codex-cli 0.158.0")).toBeLessThan(0);
    expect(
      compareCodexVersions("codex-cli 0.158.0-alpha.10", "codex-cli 0.158.0-alpha.2"),
    ).toBeGreaterThan(0);
    expect(compareCodexVersions("codex-cli 1.0.0", "codex-cli 1.0.0")).toBe(0);
    expect(compareCodexVersions("unknown", "codex-cli 0.1.0")).toBeLessThan(0);
  });
});

describe.skipIf(process.platform === "win32")("findCodexCli", () => {
  let root: string;
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };

  /** A fake `codex` in its own directory that reports `version`. */
  function fakeCodex(name: string, version: string): string {
    const dir = join(root, name);
    mkdirSync(dir);
    const path = join(dir, "codex");
    writeFileSync(path, `#!/bin/sh\necho "codex-cli ${version}"\n`);
    chmodSync(path, 0o755);
    return dir;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "codex-cli-"));
    // No install locations under a fresh home: only PATH decides.
    process.env.HOME = root;
  });

  afterEach(() => {
    process.env.PATH = saved.PATH;
    process.env.HOME = saved.HOME;
    rmSync(root, { recursive: true, force: true });
  });

  it("runs the newest CLI on PATH, not the first", async () => {
    const old = fakeCodex("old", "0.142.5");
    const newer = fakeCodex("new", "0.155.1");
    process.env.PATH = [old, newer, "/usr/bin", "/bin"].join(":");
    expect(await findCodexCli()).toEqual({
      path: join(newer, "codex"),
      version: "codex-cli 0.155.1",
    });
  });

  it("keeps PATH order between equal versions", async () => {
    const first = fakeCodex("first", "0.155.1");
    const second = fakeCodex("second", "0.155.1");
    process.env.PATH = [first, second, "/usr/bin", "/bin"].join(":");
    expect((await findCodexCli())?.path).toBe(join(first, "codex"));
  });

  it("runs only the configured CLI when one is set", async () => {
    const old = fakeCodex("old", "0.142.5");
    const newer = fakeCodex("new", "0.155.1");
    process.env.PATH = [newer, "/usr/bin", "/bin"].join(":");
    expect((await resolveCodexCli(join(old, "codex")))?.path).toBe(join(old, "codex"));
    expect(await resolveCodexCli(join(root, "missing", "codex"))).toBeNull();
  });
});
