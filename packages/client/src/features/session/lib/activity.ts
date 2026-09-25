/**
 * Fold the work between two stretches of prose into one row, the way Claude's
 * own apps keep a turn readable: "Ran 5 commands, read app.ts, edited 2 files".
 *
 * A run is the adjacent tool calls, reasoning and images the tools produced;
 * text, notices, other files and calls that ask the user something end it.
 * A run with no tool call, or with nothing but one call, stays as it is. Parts
 * that render nothing (see `isVisiblePart`) neither show nor end a run.
 */

import { rendererFor } from "../components/renderers/registry";
import { type Part, type PartOf, type ToolPart, isVisiblePart } from "./parts";

export interface IndexedPart<P = Part> {
  part: P;
  index: number;
}

/** What one folded run holds, in order. */
export type ActivityItem = IndexedPart<ToolPart | PartOf<"reasoning">>;

export type Segment =
  | { kind: "part"; part: Part; index: number }
  | {
      kind: "activity";
      items: ActivityItem[];
      /** The tool calls among `items`. */
      tools: ToolPart[];
      /** Images the tools returned (a screenshot that was read), shown with the run. */
      images: IndexedPart<PartOf<"file">>[];
    };

export function isImagePart(part: Part): part is PartOf<"file"> {
  return part.type === "file" && part.mediaType.startsWith("image/");
}

function foldable(part: Part): boolean {
  // A call that asks the user is asked on its own row; folding would hide it.
  if (part.type === "dynamic-tool") return !rendererFor(part.toolName).asksUser;
  return part.type === "reasoning" || isImagePart(part);
}

/**
 * @param hidden parts that belong elsewhere (e.g. to a subagent's timeline);
 *   treated like invisible parts.
 */
export function groupActivity(
  parts: readonly Part[],
  hidden: (part: Part) => boolean = () => false,
): Segment[] {
  const segments: Segment[] = [];
  let run: IndexedPart[] = [];
  const flush = () => {
    const tools = run.flatMap(({ part }) => (part.type === "dynamic-tool" ? [part] : []));
    if (tools.length > 0 && run.length > 1) {
      segments.push({
        kind: "activity",
        items: run.filter((entry): entry is ActivityItem => !isImagePart(entry.part)),
        tools,
        images: run.filter((entry): entry is IndexedPart<PartOf<"file">> =>
          isImagePart(entry.part),
        ),
      });
    } else {
      for (const { part, index } of run) segments.push({ kind: "part", part, index });
    }
    run = [];
  };
  parts.forEach((part, index) => {
    if (hidden(part) || !isVisiblePart(part)) return;
    if (foldable(part)) {
      run.push({ part, index });
    } else {
      flush();
      segments.push({ kind: "part", part, index });
    }
  });
  flush();
  return segments;
}
