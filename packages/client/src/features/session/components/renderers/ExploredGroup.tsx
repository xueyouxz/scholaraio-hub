import { memo, useState } from "react";
import { type IndexedPart, explorationCounts } from "../../lib/exploration";
import { ToolCallRow, type ToolPart, toolView } from "./ToolCallRow";

/**
 * A run of Read / Grep / Glob calls as one timeline row: "Exploring…" while any
 * of them runs, "Explored" with counts once all are done. Expanding shows the
 * individual calls, each still expandable on its own.
 */
export const ExploredGroup = memo(function ExploredGroup({
  calls,
  streaming,
}: {
  calls: IndexedPart<ToolPart>[];
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statuses = calls.map(({ part }) => toolView(part, streaming).status);
  const status = statuses.includes("pending")
    ? "pending"
    : statuses.includes("error")
      ? "error"
      : statuses.includes("aborted")
        ? "aborted"
        : "complete";

  return (
    <div
      className={`tool-row explored-group timeline-item ${expanded ? "expanded" : "collapsed"} status-${status}`}
    >
      <button
        type="button"
        className="tool-row-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tool-name">{status === "pending" ? "Exploring" : "Explored"}</span>
        <span className="tool-summary">{explorationCounts(calls)}</span>
        {status === "error" ? <span className="tool-outcome text-error">some failed</span> : null}
        <span className="expand-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <ul className="explored-group-body">
          {calls.map(({ part }) => (
            <li key={part.toolCallId}>
              <ToolCallRow part={part} streaming={streaming} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
