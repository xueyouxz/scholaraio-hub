/**
 * Turn the three shapes an edit can arrive in into unified-diff text:
 *
 * - Claude Code's result detail: `structuredPatch` hunks
 * - Codex file changes: `input.changes[].diff`, per file, often without headers
 * - Claude Code's input alone (no result yet): `old_string` / `new_string`
 *
 * Returns null for the last case; the caller diffs the two strings directly.
 */

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function isHunk(value: unknown): value is Hunk {
  const hunk = value as Partial<Hunk> | null;
  return (
    !!hunk &&
    typeof hunk.oldStart === "number" &&
    typeof hunk.newStart === "number" &&
    Array.isArray(hunk.lines)
  );
}

function header(path: string): string {
  // Git's a/ b/ prefixes join a relative path; strip the root of an absolute one.
  const relative = path.replace(/^\/+/, "");
  return `--- a/${relative}\n+++ b/${relative}\n`;
}

export function editPatch(input: unknown, detail: unknown): string | null {
  const data = (input ?? {}) as Record<string, unknown>;
  const path = typeof data.file_path === "string" ? data.file_path : "file";

  const hunks = (detail as { structuredPatch?: unknown } | undefined)?.structuredPatch;
  if (Array.isArray(hunks) && hunks.every(isHunk) && hunks.length) {
    const body = hunks
      .map(
        (hunk) =>
          `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`,
      )
      .join("\n");
    return `${header(path)}${body}\n`;
  }

  if (Array.isArray(data.changes)) {
    const patches = data.changes.flatMap((change) => {
      const entry = change as { path?: unknown; diff?: unknown };
      if (typeof entry.diff !== "string" || !entry.diff.includes("@@")) return [];
      const changePath = typeof entry.path === "string" ? entry.path : path;
      return [entry.diff.startsWith("---") ? entry.diff : `${header(changePath)}${entry.diff}`];
    });
    if (patches.length) return patches.map((patch) => patch.replace(/\n?$/, "\n")).join("");
  }

  const patch = data.patch ?? data.diff;
  if (typeof patch === "string" && patch.includes("@@")) return patch;
  return null;
}

/** Added / removed line counts of a unified diff. */
export function patchStats(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}
