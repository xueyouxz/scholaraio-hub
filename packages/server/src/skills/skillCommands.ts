import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SlashCommand } from "@scholaraio-hub/shared";

type SkillDir = {
  path: string;
  source: NonNullable<SlashCommand["source"]>;
};

function readFrontmatterValue(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  const value = match?.[1];
  if (!value) return null;
  return value.replace(/^["']|["']$/g, "").trim();
}

function parseSkillMarkdown(
  markdown: string,
  fallbackName: string,
  source: NonNullable<SlashCommand["source"]>,
): SlashCommand | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  if (!frontmatter) return null;

  const name = readFrontmatterValue(frontmatter, "name") ?? fallbackName;
  const description = readFrontmatterValue(frontmatter, "description") ?? "";
  if (!name) return null;

  return { name, description, source };
}

async function readSkillDir(dir: SkillDir): Promise<SlashCommand[]> {
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(dir.path, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  const commands = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillPath = join(dir.path, entry.name, "SKILL.md");
        try {
          const markdown = await readFile(skillPath, "utf8");
          return parseSkillMarkdown(markdown, entry.name, dir.source);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "ENOENT") return null;
          throw error;
        }
      }),
  );

  return commands.filter((command): command is SlashCommand => command !== null);
}

/**
 * The hub's scholaraio research skills as leading `/name` commands; the hub
 * expands them itself (see SessionService.launch), so every provider gets them.
 */
export async function getResearchSlashCommands(skillsDir: string): Promise<SlashCommand[]> {
  const commands = await readSkillDir({ path: skillsDir, source: "research" });
  return commands
    .map((command) => ({ ...command, trigger: "/" as const, position: "leading" as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
