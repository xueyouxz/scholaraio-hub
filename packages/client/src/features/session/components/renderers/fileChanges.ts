import { editPatch, patchStats } from "./patch";
import { type DiffStats, type ToolView, field } from "./types";

/** One file a tool call changed, with its diff when one can be built. */
export interface FileChange extends DiffStats {
  path: string;
  patch?: string;
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit"]);

function lines(text: string): string[] {
  const trimmed = text.replace(/\n$/, "");
  return trimmed ? trimmed.split("\n") : [];
}

/** A whole new file as a unified diff, so the diff view can show it. */
function creationPatch(path: string, content: string): string {
  const added = lines(content);
  return `--- /dev/null\n+++ b/${path.replace(/^\/+/, "")}\n@@ -0,0 +1,${added.length} @@\n${added
    .map((line) => `+${line}`)
    .join("\n")}\n`;
}

/**
 * The files a finished call changed. Edits come as Claude Code's structured
 * patch, Codex's per-file diffs, or only the replaced strings; writes as
 * Claude Code's patch of an existing file or the new file's content.
 */
export function fileChanges(view: ToolView): FileChange[] {
  if (view.status !== "complete") return [];
  const detail = view.result?.detail;
  if (EDIT_TOOLS.has(view.name)) {
    const changes = (view.input as { changes?: unknown } | undefined)?.changes;
    if (Array.isArray(changes)) {
      return changes.flatMap((change) => {
        const path = field(change, "path");
        const diff = field(change, "diff");
        if (!path) return [];
        if (!diff.includes("@@")) return [{ path, added: 0, removed: 0 }];
        const patch = editPatch({ file_path: path, changes: [change] }, undefined) ?? undefined;
        return [{ path, patch, ...patchStats(diff) }];
      });
    }
    const path = field(view.input, "file_path");
    if (!path) return [];
    const patch = editPatch(view.input, detail);
    if (patch) return [{ path, patch, ...patchStats(patch) }];
    return [
      {
        path,
        added: lines(field(view.input, "new_string")).length,
        removed: lines(field(view.input, "old_string")).length,
      },
    ];
  }
  if (view.name === "Write") {
    const path = field(view.input, "file_path");
    if (!path) return [];
    const patch = editPatch(view.input, detail);
    if (patch) return [{ path, patch, ...patchStats(patch) }];
    const content = field(view.input, "content");
    return [
      { path, patch: creationPatch(path, content), added: lines(content).length, removed: 0 },
    ];
  }
  return [];
}

/** Sum of the changes' stats, or undefined when nothing changed. */
export function totalStats(changes: readonly FileChange[]): DiffStats | undefined {
  if (!changes.length) return undefined;
  return changes.reduce(
    (sum, change) => ({ added: sum.added + change.added, removed: sum.removed + change.removed }),
    { added: 0, removed: 0 },
  );
}

/** Everything done to one file, in order. */
export interface FileSummary extends DiffStats {
  path: string;
  /** One diff per change that has one. */
  patches: string[];
}

/** Changes per file, in the order each file was first touched. */
export function changesByFile(changes: readonly FileChange[]): FileSummary[] {
  const files = new Map<string, FileSummary>();
  for (const change of changes) {
    const current = files.get(change.path) ?? {
      path: change.path,
      added: 0,
      removed: 0,
      patches: [],
    };
    current.added += change.added;
    current.removed += change.removed;
    if (change.patch) current.patches.push(change.patch);
    files.set(change.path, current);
  }
  return [...files.values()];
}
