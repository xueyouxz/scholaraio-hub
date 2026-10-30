import type { SessionMessage } from "@scholaraio-hub/shared";

export type Part = SessionMessage["parts"][number];
export type PartType = Part["type"];
export type PartOf<T extends PartType> = Extract<Part, { type: T }>;
export type ToolPart = PartOf<"dynamic-tool">;

/**
 * The part types the transcript draws in place. Anything else renders nothing
 * where it stands: citations are listed once after the turn, and step markers
 * and source parts are not shown.
 */
export const TIMELINE_PART_TYPES = [
  "text",
  "reasoning",
  "dynamic-tool",
  "data-notice",
  "file",
] as const satisfies readonly PartType[];

export type TimelinePartType = (typeof TIMELINE_PART_TYPES)[number];

const timelineTypes: ReadonlySet<PartType> = new Set(TIMELINE_PART_TYPES);

/** Whether the part shows on the timeline; blank text and reasoning do not. */
export function isVisiblePart(part: Part): boolean {
  if (part.type === "text" || part.type === "reasoning") return part.text.trim() !== "";
  return timelineTypes.has(part.type);
}
