import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentProfile } from "../profile.js";

// The server's source file, edited by hand: this command only runs from the checkout.
const manifestPath = fileURLToPath(
  new URL("../../../server/src/skills/scholaraioCategories.ts", import.meta.url),
);
const marker = "// === UNCATEGORIZED (added by skills-sync) ===";

/**
 * Report skills in the data directory that `scholaraioCategories.ts` does not
 * list, appending their names to it as a comment block for the maintainer to
 * sort into categories.
 */
export async function skillsSync(): Promise<number> {
  const skillsDir =
    process.env.SCHOLARAIO_SKILLS_DIR || path.join(currentProfile().dataDir, "skills");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.error(`skills directory not found: ${skillsDir}`);
    return 2;
  }
  const skills = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
  const manifest = await readFile(manifestPath, "utf8");
  const known = new Set([...manifest.matchAll(/"([a-z0-9][a-z0-9-]*)"/g)].map((match) => match[1]));
  const missing = skills.filter((name) => !known.has(name));
  if (missing.length === 0) {
    console.log(`All ${skills.length} skills are categorized.`);
    return 0;
  }
  console.log(`Found ${missing.length} uncategorized skills:`);
  for (const name of missing) console.log(`  - ${name}`);
  const stripped = manifest.replace(
    /\n\/\/ === UNCATEGORIZED \(added by skills[:-]sync\) ===[\s\S]*$/,
    "",
  );
  const block = [
    "",
    marker,
    "// Paste these into the appropriate SCHOLARAIO_CATEGORIES entry, then remove this block.",
    ...missing.map((name) => `// "${name}",`),
    "",
  ].join("\n");
  await writeFile(manifestPath, `${stripped}${block}`);
  console.log(`\nAppended to ${manifestPath}. Edit, move into categories, commit.`);
  return 1;
}
