#!/usr/bin/env node
/**
 * Scan SCHOLARAIO_SKILLS_DIR (default ~/scholaraio/skills) and report any skill
 * that is not present in packages/server/src/skills/scholaraioCategories.ts.
 * Appends the unknown skill names to the file as a JS comment block at the bottom
 * so the maintainer can paste them into the right category.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");
const manifestPath = join(repoRoot, "packages/server/src/skills/scholaraioCategories.ts");
const skillsDir = process.env.SCHOLARAIO_SKILLS_DIR ?? join(homedir(), "scholaraio", "skills");

async function listSkillNames(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`skills directory not found: ${dir}`);
      process.exit(2);
    }
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

async function readManifestSkills() {
  const text = await readFile(manifestPath, "utf8");
  const matches = [...text.matchAll(/"([a-z0-9][a-z0-9-]*)"/g)].map((m) => m[1]);
  return { text, names: new Set(matches) };
}

const allSkills = await listSkillNames(skillsDir);
const { text: manifestText, names: known } = await readManifestSkills();
const missing = allSkills.filter((name) => !known.has(name));

if (missing.length === 0) {
  console.log(`All ${allSkills.length} skills are categorized.`);
  process.exit(0);
}

console.log(`Found ${missing.length} uncategorized skills:`);
for (const name of missing) console.log(`  - ${name}`);

const marker = "// === UNCATEGORIZED (added by skills:sync) ===";
const stripped = manifestText.replace(new RegExp(`\\n${marker}[\\s\\S]*$`), "");
const block = [
  "",
  marker,
  "// Paste these into the appropriate SCHOLARAIO_CATEGORIES entry, then remove this block.",
  ...missing.map((n) => `// "${n}",`),
  "",
].join("\n");
await writeFile(manifestPath, `${stripped}${block}`);
console.log(`\nAppended to ${manifestPath}. Edit, move into categories, commit.`);
process.exit(1);
