import { useState } from "react";

/** Monospace block; long content is clipped until the reader asks for all of it. */
export function CodeBlock({
  text,
  error = false,
  startLine,
  maxLines = 40,
}: {
  text: string;
  error?: boolean;
  /** Show line numbers starting here. */
  startLine?: number;
  maxLines?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const clipped = !showAll && lines.length > maxLines;
  const visible = clipped ? lines.slice(0, maxLines) : lines;
  const numbered = startLine !== undefined;
  return (
    <div className="tool-code">
      {numbered ? (
        <div className="file-content-with-lines">
          <div className="line-numbers" aria-hidden="true">
            {visible
              .map((_, offset) => startLine + offset)
              .map((number) => (
                <div key={number}>{number}</div>
              ))}
          </div>
          <pre className="line-content">
            <code>{visible.join("\n")}</code>
          </pre>
        </div>
      ) : (
        <pre className={`code-block${error ? " code-block-error" : ""}`}>
          <code>{visible.join("\n")}</code>
        </pre>
      )}
      {clipped ? (
        <button type="button" className="show-more-btn" onClick={() => setShowAll(true)}>
          Show all {lines.length} lines
        </button>
      ) : null}
    </div>
  );
}

/** The last few lines of output, the way a terminal shows a running command. */
export function OutputTail({
  text,
  lines = 4,
  error = false,
}: {
  text: string;
  lines?: number;
  error?: boolean;
}) {
  const all = text.replace(/\n$/, "").split("\n");
  if (!text.trim()) return null;
  const hidden = all.length - lines;
  return (
    <div className="bash-collapsed-preview">
      {hidden > 0 ? <div className="bash-preview-truncated">… {hidden} more lines</div> : null}
      <div className={`bash-preview-output${error ? " bash-preview-error" : ""}`}>
        <pre>{all.slice(-lines).join("\n")}</pre>
      </div>
    </div>
  );
}
