import type { SessionMessage } from "@scholaraio-hub/shared";
import { memo, useState } from "react";

const MAX_LINES = 12;
const MAX_CHARS = MAX_LINES * 100;

/** The user's message: a right-aligned bubble with its attachments. */
export const UserPrompt = memo(function UserPrompt({ message }: { message: SessionMessage }) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  const files = message.parts.filter((part) => part.type === "file");
  return (
    <div className="user-prompt-container">
      <div className="message message-user-prompt">
        <div className="message-content">
          {text ? <CollapsibleText text={text} /> : null}
          {files.length ? (
            <div className="user-prompt-metadata">
              {files.map((file) => (
                <a
                  key={file.url}
                  className="uploaded-file uploaded-file-clickable"
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  title={file.mediaType}
                >
                  📎 {file.filename || "附件"}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/** Long prompts show their first lines until expanded. */
function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > MAX_LINES || text.length > MAX_CHARS;
  if (!needsTruncation || expanded) {
    return (
      <div className="text-block">
        {text}
        {expanded ? (
          <button type="button" className="show-more-btn" onClick={() => setExpanded(false)}>
            Show less
          </button>
        ) : null}
      </div>
    );
  }
  const truncated = lines.slice(0, MAX_LINES).join("\n").slice(0, MAX_CHARS);
  return (
    <div className="text-block collapsible-text">
      <div className="truncated-content">
        {truncated}
        <div className="fade-overlay" />
      </div>
      <button type="button" className="show-more-btn" onClick={() => setExpanded(true)}>
        Show more
      </button>
    </div>
  );
}
