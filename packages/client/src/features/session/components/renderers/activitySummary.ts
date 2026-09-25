import { fileChanges, totalStats } from "./fileChanges";
import { canonicalToolName } from "./registry";
import { type DiffStats, type ToolView, field, fileName, plural } from "./types";

/** How the calls of one kind read in a summary, given every call of that kind. */
type Phrase = (views: ToolView[]) => string;

const PHRASES: Record<string, Phrase> = {
  Bash: (views) => `ran ${plural(views.length, "command")}`,
  Read: (views) => {
    const files = new Set(views.map((view) => field(view.input, "file_path")));
    const [only] = files;
    return files.size === 1 && only
      ? `read ${fileName(only)}`
      : `read ${plural(files.size, "file")}`;
  },
  Edit: (views) => edited(views),
  Write: (views) => edited(views),
  Grep: (views) => `searched ${plural(views.length, "pattern")}`,
  Glob: (views) => `listed ${plural(views.length, "pattern")}`,
  WebSearch: (views) => `searched the web${views.length > 1 ? ` ${views.length} times` : ""}`,
  WebFetch: (views) => `fetched ${plural(views.length, "page")}`,
  Task: (views) => `ran ${plural(views.length, "agent")}`,
  TodoWrite: () => "updated the plan",
};

function edited(views: ToolView[]): string {
  const files = new Set(
    views.flatMap((view) => {
      const changes = fileChanges(view);
      return changes.length
        ? changes.map((change) => change.path)
        : [field(view.input, "file_path")];
    }),
  );
  files.delete("");
  const [only] = files;
  return files.size === 1 && only
    ? `edited ${fileName(only)}`
    : `edited ${plural(files.size, "file")}`;
}

/** Edit and Write read as one phrase: both change files. */
const PHRASE_KEY: Record<string, string> = { Write: "Edit" };

export interface ActivitySummary {
  /** "Ran 5 commands, read app.ts, edited 2 files". */
  text: string;
  /** Lines the run's edits added and removed. */
  stats?: DiffStats;
}

/** Describe a folded run by what its calls did, in the order each kind first appears. */
export function summarizeActivity(views: readonly ToolView[]): ActivitySummary {
  const kinds = new Map<string, ToolView[]>();
  for (const view of views) {
    const name = canonicalToolName(view.name);
    const key = PHRASES[name] ? (PHRASE_KEY[name] ?? name) : "*";
    kinds.set(key, [...(kinds.get(key) ?? []), view]);
  }
  const phrases = [...kinds].map(([key, group]) =>
    key === "*" ? `used ${plural(group.length, "tool")}` : (PHRASES[key] as Phrase)(group),
  );
  const text = phrases.join(", ");
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    stats: totalStats(views.flatMap(fileChanges)),
  };
}
