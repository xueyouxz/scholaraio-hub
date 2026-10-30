import { memo, useState } from "react";
import { Markdown } from "../../../../shared/components/Markdown";
import { Chevron } from "../renderers/ToolCallRow";

/** The agent's reasoning, collapsed by default; it pulses while it streams. */
export const ReasoningPart = memo(function ReasoningPart({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={`thinking-block collapsible timeline-item${streaming && !open ? " thinking-streaming-collapsed" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapsible__summary">
        <span>{streaming ? "Thinking..." : "Thinking"}</span>
        <Chevron open={open} />
      </summary>
      {/* Parsed only while open: closed reasoning costs nothing per delta. */}
      {open ? (
        <div className="collapsible__content">
          <Markdown text={text} streaming={streaming} className="session-markdown" />
        </div>
      ) : null}
    </details>
  );
});
