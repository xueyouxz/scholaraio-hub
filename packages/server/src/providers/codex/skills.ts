import type { SlashCommand, UploadedFile } from "@scholaraio-hub/shared";
import { isInlineImage } from "../MessageQueue.js";
import type { CodexAppServerClient } from "./CodexAppServerClient.js";
import type { UserInput } from "./protocol/index.js";

/**
 * Codex skills: the commands the composer offers for Codex, and the native
 * skill items a turn's input carries when the user mentions one as `$name`.
 */

/** The fields of app-server `skills/list` entries the hub reads (see generated v2 `SkillMetadata`). */
export interface AppServerSkill {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: { shortDescription?: string };
  path: string;
  scope: "user" | "repo" | "system" | "admin";
  enabled: boolean;
}

export async function listCodexSkills(
  appServer: Pick<CodexAppServerClient, "request">,
  cwd: string,
): Promise<AppServerSkill[]> {
  const response = await appServer.request<{ data: Array<{ skills: AppServerSkill[] }> }>(
    "skills/list",
    { cwds: [cwd] },
  );
  return response.data.flatMap((entry) => entry.skills).filter((skill) => skill.enabled);
}

export function toCodexSkillCommand(skill: AppServerSkill): SlashCommand {
  return {
    name: skill.name,
    description: skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description,
    source: skill.scope === "repo" ? "project" : "global",
    trigger: "$",
    position: "anywhere",
  };
}

const SKILL_MENTION = /(^|\s)\$([A-Za-z0-9_.:-]+)/g;

/**
 * The turn input for `text`: the text itself, one native skill item per
 * `$name` it mentions (unknown names stay text), and each uploaded image as a
 * `localImage` the model sees, as the Codex TUI sends them. Other files are
 * listed by path in the text for the agent to open.
 */
export function codexUserInput(
  text: string,
  skills: AppServerSkill[],
  attachments: UploadedFile[] = [],
): UserInput[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const mentioned = new Map<string, AppServerSkill>();
  for (const match of text.matchAll(SKILL_MENTION)) {
    const skill = byName.get(match[2] ?? "");
    if (skill) mentioned.set(skill.name, skill);
  }
  return [
    { type: "text", text, text_elements: [] },
    ...[...mentioned.values()].map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      path: skill.path,
    })),
    ...attachments
      .filter(isInlineImage)
      .map((file) => ({ type: "localImage" as const, path: file.path })),
  ];
}

/** `codexUserInput`, listing the workspace's skills only when the text mentions one. */
export async function withSkillMentions(
  appServer: Pick<CodexAppServerClient, "request">,
  cwd: string,
  text: string,
  attachments?: UploadedFile[],
): Promise<UserInput[]> {
  const skills = text.includes("$") ? await listCodexSkills(appServer, cwd) : [];
  return codexUserInput(text, skills, attachments);
}
