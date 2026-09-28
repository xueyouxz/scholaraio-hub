import type { SessionMessage } from "@scholaraio-hub/shared";
import { GitBranch, Pencil } from "lucide-react";
import { memo, useState } from "react";
import { CopyButton } from "./CopyButton";
import { FileAttachment } from "./FileAttachment";
import { ImageThumb } from "./parts/ImagePart";

const MAX_LINES = 12;
const MAX_CHARS = MAX_LINES * 100;

/** What the user can do with a prompt they sent; absent actions are not offered. */
export interface PromptActions {
  /** Bring this prompt back into the composer to correct it. */
  onEdit?(message: SessionMessage): void;
  /** Continue from this turn in a new session. */
  onFork?(message: SessionMessage): void;
  /** Edit and fork wait while a turn runs or one of them is underway. */
  busy?: boolean;
}

/**
 * The user's message: its attachments above a right-aligned bubble, and under
 * it copy, edit and fork, shown on hover the way Claude's apps show them.
 * While it is being corrected in the composer it is marked as such.
 */
export const UserPrompt = memo(function UserPrompt({
  message,
  onEdit,
  onFork,
  busy = false,
  editing = false,
}: { message: SessionMessage; editing?: boolean } & PromptActions) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  const files = message.parts.filter((part) => part.type === "file");
  // Pictures and videos in one row, documents in a row under them.
  const isMedia = (file: (typeof files)[number]) => /^(image|video)\//.test(file.mediaType);
  const media = files.filter(isMedia);
  const documents = files.filter((file) => !isMedia(file));

  return (
    <div className={`user-prompt-container${editing ? " is-editing" : ""}`}>
      {files.length ? (
        <div className="user-prompt-attachments">
          {media.length ? (
            <ul className="user-prompt-attachment-row" aria-label="图片和视频">
              {media.map((file) => (
                <li key={file.url}>
                  {file.mediaType.startsWith("image/") ? (
                    <ImageThumb url={file.url} name={file.filename} />
                  ) : (
                    <FileAttachment
                      url={file.url}
                      filename={file.filename}
                      mediaType={file.mediaType}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {documents.length ? (
            <ul className="user-prompt-attachment-row" aria-label="文档">
              {documents.map((file) => (
                <li key={file.url} className="max-w-full">
                  <FileAttachment
                    url={file.url}
                    filename={file.filename}
                    mediaType={file.mediaType}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {text ? (
        <div className="message message-user-prompt">
          <div className="message-content">
            <CollapsibleText text={text} />
          </div>
        </div>
      ) : null}
      <div className="message-actions">
        {text ? <CopyButton text={text} label="复制消息" /> : null}
        {onEdit ? (
          <button
            type="button"
            className="message-action"
            disabled={busy || editing}
            onClick={() => onEdit(message)}
            title="在输入框中编辑后重新发送：替换这条消息和它的回复（文件改动不会撤销）"
            aria-label="编辑消息"
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        ) : null}
        {onFork ? (
          <button
            type="button"
            className="message-action"
            disabled={busy}
            onClick={() => onFork(message)}
            title="从这一轮分叉出新会话"
            aria-label="从这里分叉"
          >
            <GitBranch size={14} aria-hidden="true" />
          </button>
        ) : null}
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
