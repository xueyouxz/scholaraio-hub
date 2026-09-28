import type { SessionMessage } from "@scholaraio-hub/shared";
import { GitBranch, Pencil } from "lucide-react";
import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { FileAttachment } from "./FileAttachment";
import { ImageThumb } from "./parts/ImagePart";

const MAX_LINES = 12;
const MAX_CHARS = MAX_LINES * 100;

/** What the user can do with a prompt they sent; absent actions are not offered. */
export interface PromptActions {
  /** Send an edited version in place of this prompt; resolves once the server took it. */
  onEdit?(message: SessionMessage, text: string): Promise<void>;
  /** Continue from this turn in a new session. */
  onFork?(message: SessionMessage): void;
  /** Edit and fork wait while a turn runs or one of them is underway. */
  busy?: boolean;
}

/**
 * The user's message: its attachments above a right-aligned bubble, and under
 * it copy, edit and fork, shown on hover the way Claude's apps show them.
 */
export const UserPrompt = memo(function UserPrompt({
  message,
  onEdit,
  onFork,
  busy = false,
}: { message: SessionMessage } & PromptActions) {
  const [editing, setEditing] = useState(false);
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  const files = message.parts.filter((part) => part.type === "file");
  // Pictures and videos in one row, documents in a row under them.
  const isMedia = (file: (typeof files)[number]) => /^(image|video)\//.test(file.mediaType);
  const media = files.filter(isMedia);
  const documents = files.filter((file) => !isMedia(file));

  if (editing && onEdit) {
    return (
      <PromptEditor
        initial={text}
        onCancel={() => setEditing(false)}
        onSubmit={async (next) => {
          await onEdit(message, next);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="user-prompt-container">
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
            disabled={busy}
            onClick={() => setEditing(true)}
            title="编辑后重新发送（之后的对话会被替换，文件改动不会撤销）"
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

/** The bubble turned into a text box; Enter sends, Shift+Enter breaks, Escape cancels. */
function PromptEditor({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel(): void;
  onSubmit(text: string): Promise<void>;
}) {
  const [text, setText] = useState(initial);
  // The user just asked to edit this prompt: the text box takes the focus.
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    const value = text.trim();
    if (!value || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") onCancel();
    else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className="user-prompt-container">
      <div className="prompt-editor">
        <textarea
          ref={field}
          aria-label="编辑消息"
          value={text}
          rows={Math.min(12, Math.max(2, text.split("\n").length))}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {error ? (
          <p role="alert" className="prompt-editor-error">
            {error}
          </p>
        ) : null}
        <div className="prompt-editor-actions">
          <button type="button" className="prompt-editor-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="prompt-editor-send"
            disabled={pending || !text.trim()}
            onClick={() => void submit()}
          >
            {pending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
