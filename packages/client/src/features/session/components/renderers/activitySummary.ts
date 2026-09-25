import { totalStats } from "./fileChanges";
import { fileChanges, rendererFor } from "./registry";
import { type DiffStats, type ToolRenderer, type ToolView, plural } from "./types";

export interface ActivitySummary {
  /** "Ran 5 commands, read app.ts, edited 2 files". */
  text: string;
  /** Lines the run's edits added and removed. */
  stats?: DiffStats;
}

type Phrase = NonNullable<ToolRenderer["phrase"]>;

/**
 * Describe a folded run by what its calls did, in the order each kind first
 * appears. Calls whose tools share a phrase (edits and writes) read as one;
 * tools without a phrase are counted together, where the first of them appears.
 */
export function summarizeActivity(views: readonly ToolView[]): ActivitySummary {
  const kinds = new Map<Phrase | undefined, ToolView[]>();
  for (const view of views) {
    const phrase = rendererFor(view.name).phrase;
    kinds.set(phrase, [...(kinds.get(phrase) ?? []), view]);
  }
  const text = [...kinds]
    .map(([phrase, group]) => (phrase ? phrase(group) : `used ${plural(group.length, "tool")}`))
    .join(", ");
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    stats: totalStats(views.flatMap(fileChanges)),
  };
}
