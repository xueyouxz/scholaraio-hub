/**
 * Collapse runs of look-around tool calls (Read / Grep / Glob) into one
 * "Explored" row, the way Claude Code keeps a turn readable when the agent
 * opens a dozen files before doing anything.
 *
 * Grouping follows Yep Anywhere's exploration projection: only adjacent calls
 * group, anything else that renders (text, reasoning, an edit) ends the run,
 * and a run of one stays a normal row. Parts that render nothing do not end a
 * run — they cannot visibly separate anything.
 */

import { type Part, type ToolPart, isVisiblePart } from "./parts";

export type ExplorationKind = "read" | "search" | "list";

const EXPLORATION_KINDS: Record<string, ExplorationKind> = {
  Read: "read",
  Grep: "search",
  Glob: "list",
};

export function explorationKind(toolName: string): ExplorationKind | undefined {
  return EXPLORATION_KINDS[toolName];
}

export interface IndexedPart<P = Part> {
  part: P;
  index: number;
}

export type Segment =
  | { kind: "part"; part: Part; index: number }
  | { kind: "explored"; calls: IndexedPart<ToolPart>[] };

function isExploration(part: Part): part is ToolPart {
  return part.type === "dynamic-tool" && explorationKind(part.toolName) !== undefined;
}

/**
 * Parts that render nothing on the timeline (see `isVisiblePart`) neither show
 * nor split a group.
 *
 * @param hidden parts that belong elsewhere (e.g. to a subagent's timeline);
 *   treated like invisible parts.
 */
export function groupExploration(
  parts: readonly Part[],
  hidden: (part: Part) => boolean = () => false,
): Segment[] {
  const segments: Segment[] = [];
  let run: IndexedPart<ToolPart>[] = [];
  const flush = () => {
    if (run.length >= 2) segments.push({ kind: "explored", calls: run });
    else if (run[0]) segments.push({ kind: "part", part: run[0].part, index: run[0].index });
    run = [];
  };
  parts.forEach((part, index) => {
    if (hidden(part)) return;
    if (isExploration(part)) {
      run.push({ part, index });
    } else if (isVisiblePart(part)) {
      flush();
      segments.push({ kind: "part", part, index });
    }
  });
  flush();
  return segments;
}

/** "3 files read · 2 searches" for a group header. */
export function explorationCounts(calls: readonly IndexedPart<ToolPart>[]): string {
  const counts = { read: 0, search: 0, list: 0 };
  for (const { part } of calls) {
    const kind = explorationKind(part.toolName);
    if (kind) counts[kind]++;
  }
  const phrases = [
    counts.read ? `${counts.read} ${counts.read === 1 ? "file" : "files"}` : "",
    counts.search ? `${counts.search} ${counts.search === 1 ? "search" : "searches"}` : "",
    counts.list ? `${counts.list} ${counts.list === 1 ? "listing" : "listings"}` : "",
  ];
  return phrases.filter(Boolean).join(" · ");
}
