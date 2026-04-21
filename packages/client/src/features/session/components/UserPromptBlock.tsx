import { memo, useCallback, useState } from "react";
import type { SessionContentBlock } from "../model";

const MAX_LINES = 12;
const MAX_CHARS = MAX_LINES * 100;

interface Props {
  content: string | SessionContentBlock[];
}

function extractText(content: string | SessionContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (block): block is SessionContentBlock & { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function PreviewText({ text }: { text: string }) {
  const lines = text.split("\n");
  const exceedsLines = lines.length > MAX_LINES;
  const exceedsChars = text.length > MAX_CHARS;
  const needsTruncation = exceedsLines || exceedsChars;

  if (!needsTruncation) {
    return <div className="text-block">{text}</div>;
  }

  let truncated = exceedsLines ? lines.slice(0, MAX_LINES).join("\n") : text;
  if (truncated.length > MAX_CHARS) {
    truncated = truncated.slice(0, MAX_CHARS);
  }

  return (
    <div className="text-block collapsible-text">
      <div className="truncated-content">
        {truncated}
        <div className="fade-overlay" aria-hidden="true" />
      </div>
    </div>
  );
}

export const UserPromptBlock = memo(function UserPromptBlock({ content }: Props) {
  const text = extractText(content);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard failures are ignored.
    }
  }, [text]);

  if (!text) return null;

  return (
    <div className="user-prompt-container">
      <div className="user-prompt-stack">
        <div className="message message-user-prompt">
          <div className="message-content">
            <PreviewText text={text} />
          </div>
        </div>
        <div className="user-prompt-actions">
          <button
            type="button"
            className={`text-block-copy${copied ? " copied" : ""}`}
            onClick={() => void handleCopy()}
            aria-label={copied ? "Copied" : "Copy message"}
          >
            {copied ? "✓" : "⧉"}
          </button>
        </div>
      </div>
    </div>
  );
});
