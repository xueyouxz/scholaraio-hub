import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScholaraioSkill, ScholaraioSkillDetail } from "@scholaraio-hub/shared";
import { getCategoryIdForSkill } from "./scholaraioCategories.js";

interface CachedSkill extends ScholaraioSkillDetail {}

let cache: Map<string, CachedSkill> | null = null;
let cacheDir: string | null = null;

function readFrontmatterValue(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  const value = match?.[1];
  if (!value) return null;
  return value.replace(/^["']|["']$/g, "").trim();
}

function parseSkillMarkdown(
  markdown: string,
  fallbackName: string,
  absPath: string,
): CachedSkill | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const body = match[2] ?? "";
  if (!frontmatter) return null;

  const name = readFrontmatterValue(frontmatter, "name") ?? fallbackName;
  const description = readFrontmatterValue(frontmatter, "description") ?? "";
  if (!name) return null;

  return {
    name,
    description,
    category: getCategoryIdForSkill(name),
    source: "research",
    body,
    path: absPath,
  };
}

async function scanSkillsDir(dir: string): Promise<Map<string, CachedSkill>> {
  const result = new Map<string, CachedSkill>();
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const skillPath = join(dir, entry.name, "SKILL.md");
    let markdown: string;
    try {
      markdown = await readFile(skillPath, "utf8");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT") continue;
      throw error;
    }
    const parsed = parseSkillMarkdown(markdown, entry.name, skillPath);
    if (parsed) result.set(parsed.name, parsed);
  }

  return result;
}

async function ensureCache(dir: string): Promise<Map<string, CachedSkill>> {
  if (cache && cacheDir === dir) return cache;
  cache = await scanSkillsDir(dir);
  cacheDir = dir;
  return cache;
}

export async function listScholaraioSkills(dir: string): Promise<ScholaraioSkill[]> {
  const map = await ensureCache(dir);
  return [...map.values()]
    .map(({ body: _body, path: _path, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getScholaraioSkill(
  dir: string,
  name: string,
): Promise<ScholaraioSkillDetail | null> {
  const map = await ensureCache(dir);
  return map.get(name) ?? null;
}

export function invalidateScholaraioSkillsCache(): void {
  cache = null;
  cacheDir = null;
}
