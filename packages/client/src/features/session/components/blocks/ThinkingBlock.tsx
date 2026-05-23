import { memo, useState } from "react";

interface Props {
  thinking: string;
  status: "streaming" | "complete";
  /** 初始展开状态，默认 false */
  defaultExpanded?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  status,
  defaultExpanded = false,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const isStreaming = status === "streaming";
  const className = [
    "thinking-block",
    "collapsible",
    "timeline-item",
    isStreaming && !isExpanded ? "thinking-streaming-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <details
      className={className}
      open={isExpanded}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next !== isExpanded) {
          setIsExpanded(next);
        }
      }}
    >
      <summary className="collapsible__summary">
        <span>{isStreaming ? "Thinking..." : "Thinking"}</span>
        <span className="collapsible__icon">▸</span>
      </summary>
      <div className="collapsible__content">
        <span className="text-content">{thinking}</span>
      </div>
    </details>
  );
});
