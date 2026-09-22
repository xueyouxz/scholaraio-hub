interface ThinkingIndicatorProps {
  variant?: "dot" | "pill";
  label?: string;
  className?: string;
}

export function ThinkingIndicator({
  variant = "dot",
  label = "Thinking",
  className,
}: ThinkingIndicatorProps) {
  const dot = <span className="thinking-indicator-dot" />;

  if (variant === "pill") {
    return (
      <span className={`thinking-indicator-pill ${className ?? ""}`}>
        {dot}
        <span className="thinking-indicator-label">{label}</span>
      </span>
    );
  }

  return <span className={`thinking-indicator ${className ?? ""}`}>{dot}</span>;
}
