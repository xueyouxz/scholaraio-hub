import { type LibraryCitation, parentCallIdOf } from "@scholaraio-hub/shared";
import { type Segment, groupExploration } from "./exploration";
import type { Part, ToolPart } from "./parts";

/** A subagent's work, shown inside the call that started it. */
export interface NestedTimeline {
  segments: Segment[];
  /** Tool calls the subagent made, in order. */
  tools: ToolPart[];
}

/** One assistant message laid out for the transcript. */
export interface TurnTree {
  /** The main agent's timeline. */
  segments: Segment[];
  /** Subagent timelines by the call id that started each. */
  nested: ReadonlyMap<string, NestedTimeline>;
  /** Library passages the answer cites, listed once after the turn. */
  citations: LibraryCitation[];
}

/**
 * Lay out an assistant message: split subagent work from the main agent's,
 * then collapse exploration runs in each timeline.
 *
 * A part whose parent call is not in this message (it started before the
 * browser attached) stays on the main timeline rather than disappearing.
 */
export function buildTurnTree(parts: readonly Part[]): TurnTree {
  const callIds = new Set(
    parts.flatMap((part) => (part.type === "dynamic-tool" ? [part.toolCallId] : [])),
  );
  const scopeOf = (part: Part): string | undefined => {
    const parent = parentCallIdOf(part);
    return parent && callIds.has(parent) ? parent : undefined;
  };

  const scopes = new Set<string>();
  const tools = new Map<string, ToolPart[]>();
  for (const part of parts) {
    const scope = scopeOf(part);
    if (!scope) continue;
    scopes.add(scope);
    if (part.type === "dynamic-tool") tools.set(scope, [...(tools.get(scope) ?? []), part]);
  }

  const nested = new Map<string, NestedTimeline>();
  for (const scope of scopes) {
    nested.set(scope, {
      segments: groupExploration(parts, (part) => scopeOf(part) !== scope),
      tools: tools.get(scope) ?? [],
    });
  }

  return {
    segments: groupExploration(parts, (part) => scopeOf(part) !== undefined),
    nested,
    citations: parts.flatMap((part) => (part.type === "data-citations" ? part.data : [])),
  };
}

export function citationUrl(citation: LibraryCitation): string {
  return `/library/${encodeURIComponent(citation.paperId)}?mode=markdown&line=${citation.startLine}`;
}

/** Turn `[ref-3]` markers into links to the cited passage; unknown ids stay as written. */
export function linkCitations(text: string, citations: readonly LibraryCitation[]): string {
  if (!citations.length) return text;
  return text.replace(/\[(ref-\d+)\]/g, (original, id: string) => {
    const citation = citations.find((item) => item.id === id);
    return citation ? `[${id.slice(4)}](${citationUrl(citation)})` : original;
  });
}
