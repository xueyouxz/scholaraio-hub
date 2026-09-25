import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { loggerFor } from "../logging/logger.js";

/**
 * Research skills are user-owned data, not application code: they live in the
 * application data directory so a user can edit, add and remove them without
 * touching the checkout.
 */
export function skillsDirectory(dataDir: string): string {
  return path.join(dataDir, "skills");
}

/** Location used before skills moved into the data directory. */
export function legacySkillsDirectory(): string {
  return path.join(homedir(), "scholaraio", "skills");
}

async function entryCount(directory: string): Promise<number | null> {
  try {
    return (await readdir(directory)).length;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Create the skills directory, seeding it once from the legacy location.
 *
 * An existing directory is never touched: after the first start it owns its
 * skills, including any the user deleted.
 */
export async function ensureSkillsDirectory(
  directory: string,
  legacy: string = legacySkillsDirectory(),
): Promise<string> {
  if ((await entryCount(directory)) !== null) return directory;
  if ((await entryCount(legacy)) === null) {
    await mkdir(directory, { recursive: true });
    return directory;
  }
  await cp(legacy, directory, { recursive: true, dereference: true, errorOnExist: true });
  loggerFor("skills").info(
    { from: legacy, to: directory },
    "Imported research skills into the data directory",
  );
  return directory;
}
