import path from "node:path";
import { describe, expect, it } from "vitest";
import { DirectoryRules, projectId, projectPath } from "../../src/projects/directories.js";

const home = "/Users/ada";
const rules = new DirectoryRules({
  home,
  dataDir: "/data/hub",
  temporary: ["/tmp", "/private/var/folders"],
});

describe("project ids", () => {
  it("round-trip a path, whatever characters it holds", () => {
    const directory = "/Users/ada/毕业/光伏 可视化";
    expect(projectPath(projectId(directory))).toBe(directory);
    expect(projectId(directory)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse what does not decode to an absolute path", () => {
    expect(projectPath("unassigned")).toBeUndefined();
    expect(projectPath(projectId("relative/dir"))).toBeUndefined();
  });
});

describe("which directories are projects", () => {
  it.each([
    "/",
    home,
    "/tmp/scratch",
    "/private/var/folders/x/T/hub-real-cli-1/sessions/a/workspace",
    "/data/hub/sessions/a/workspace",
    path.join(home, ".scholaraio-hub", "workspace", "综述"),
    path.join(home, ".scholaraio-hub-dev", "sessions", "a", "workspace"),
    path.join(home, "Library", "Application Support", "Claude", "scratch-workspaces", "a", "b"),
    path.join(home, "Documents", "Codex", "2026-09-27", "new-chat"),
  ])("%s holds sessions without a project", (directory) => {
    expect(rules.isProjectless(directory)).toBe(true);
  });

  it.each([
    path.join(home, "Projects", "hub"),
    path.join(home, "Documents", "Codex-notes"),
    path.join(home, ".scholaraio"),
    "/srv/app",
  ])("%s is a project", (directory) => {
    expect(rules.isProjectless(directory)).toBe(false);
  });
});
