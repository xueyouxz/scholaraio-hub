import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSkillsDirectory, skillsDirectory } from "../../src/skills/skillsDirectory.js";

function legacySkills(): string {
  const root = mkdtempSync(path.join(tmpdir(), "skills-legacy-"));
  mkdirSync(path.join(root, "search"));
  writeFileSync(path.join(root, "search", "SKILL.md"), "---\nname: search\n---\n");
  return root;
}

function dataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "skills-data-"));
}

describe("skills directory", () => {
  it("lives in the application data directory", () => {
    expect(skillsDirectory("/data")).toBe(path.join("/data", "skills"));
  });

  it("seeds once from the legacy location", async () => {
    const root = dataDir();
    const directory = await ensureSkillsDirectory(root, legacySkills());
    expect(readFileSync(path.join(directory, "search", "SKILL.md"), "utf8")).toContain("search");
  });

  it("keeps the user's own edits on later starts", async () => {
    const root = dataDir();
    const legacy = legacySkills();
    const directory = await ensureSkillsDirectory(root, legacy);
    writeFileSync(path.join(directory, "search", "SKILL.md"), "---\nname: mine\n---\n");

    await ensureSkillsDirectory(root, legacy);
    expect(readFileSync(path.join(directory, "search", "SKILL.md"), "utf8")).toContain("mine");
  });

  it("creates an empty directory when there is nothing to seed", async () => {
    const missing = path.join(tmpdir(), "skills-absent-", String(Date.now()));
    expect(readdirSync(await ensureSkillsDirectory(dataDir(), missing))).toEqual([]);
  });
});
