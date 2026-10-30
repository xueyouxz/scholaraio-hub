import type { ReactNode } from "react";

/** What a badge says about its subject, as `.design/DESIGN.md` colours it ("Status Badges"). */
export type BadgeTone = "positive" | "neutral" | "failure" | "kind" | "attention";

const TONES: Record<BadgeTone, string> = {
  /** Done, ready, added. */
  positive: "text-primary bg-primary/15",
  /** Counts and states that need nothing. */
  neutral: "text-on-surface-variant bg-surface-container",
  /** Parse or import failures, something missing. */
  failure: "text-error bg-error-container/40",
  /** What a thing is: PDF, Markdown. */
  kind: "text-secondary bg-secondary-container/30",
  /** Working, or waiting on the reader. */
  attention: "text-tertiary bg-tertiary-container/30",
};

/** A short mono label stating a status or a kind. */
export function Badge({
  tone,
  className = "",
  children,
}: {
  tone: BadgeTone;
  /** Placement only (e.g. pinned to a card's corner); the look is the tone's. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded leading-none uppercase ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
