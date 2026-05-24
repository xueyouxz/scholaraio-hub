import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName, SlashCommand } from "@scholaraio-hub/shared";

type SkillDir = {
  path: string;
  source: NonNullable<SlashCommand["source"]>;
};

function providerSkillDirs(
  projectPath: string,
  provider: ProviderName | string | undefined,
): SkillDir[] {
  const globalAgentSkills = join(homedir(), ".agents", "skills");
  const projectAgentSkills = join(projectPath, ".agents", "skills");

  if (provider === "claude" || provider === "claude-ollama") {
    return [
      { path: globalAgentSkills, source: "global" },
      { path: join(homedir(), ".claude", "skills"), source: "global" },
      { path: projectAgentSkills, source: "project" },
      { path: join(projectPath, ".claude", "skills"), source: "project" },
    ];
  }
  if (provider === "codex" || provider === "codex-oss") {
    return [
      { path: globalAgentSkills, source: "global" },
      { path: join(homedir(), ".codex", "skills"), source: "global" },
      { path: projectAgentSkills, source: "project" },
      { path: join(projectPath, ".codex", "skills"), source: "project" },
    ];
  }
  return [];
}

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

export async function getSkillSlashCommands(
  projectPath: string,
  provider: ProviderName | string | undefined,
  scholaraioSkillsDir?: string,
): Promise<SlashCommand[]> {
  const byName = new Map<string, SlashCommand>();

  for (const dir of providerSkillDirs(projectPath, provider)) {
    const commands = await readSkillDir(dir);
    for (const command of commands) {
      byName.set(command.name, command);
    }
  }

  const merged: SlashCommand[] = [...byName.values()];

  if (scholaraioSkillsDir) {
    const researchCommands = await readSkillDir({
      path: scholaraioSkillsDir,
      source: "research",
    });
    for (const command of researchCommands) {
      // Keep duplicates across sources so users see both (with source tag).
      merged.push(command);
    }
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
