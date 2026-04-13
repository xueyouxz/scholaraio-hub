import type { ThinkingOption } from "../../../core/types";

interface MessageInputToolbarProps {
  thinking: ThinkingOption;
  onThinkingChange: (value: ThinkingOption) => void;
  canAttach: boolean;
  attachmentCount: number;
  onAttachClick: () => void;
  onSend: () => void;
  canSend: boolean;
  disabled?: boolean;
}

export function MessageInputToolbar({
  thinking,
  onThinkingChange,
  canAttach,
  attachmentCount,
  onAttachClick,
  onSend,
  canSend,
  disabled = false,
}: MessageInputToolbarProps) {
  return (
    <div className="message-input-toolbar">
      <div className="message-input-left">
        <label className="message-input-thinking">
          <span className="eyebrow">Thinking</span>
          <select
            value={thinking}
            onChange={(event) => onThinkingChange(event.target.value as ThinkingOption)}
          >
            <option value="off">off</option>
            <option value="auto">auto</option>
            <option value="on:medium">on:medium</option>
            <option value="on:high">on:high</option>
          </select>
        </label>
        <button
          type="button"
          className="attach-button"
          onClick={onAttachClick}
          disabled={!canAttach}
          title={canAttach ? "Attach files" : "File attachments unavailable"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          {attachmentCount > 0 ? <span className="attach-count">{attachmentCount}</span> : null}
        </button>
      </div>
      <div className="message-input-actions">
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !canSend}
          className="send-button"
          aria-label="Send"
        >
          <span className="send-icon">↑</span>
        </button>
      </div>
    </div>
  );
}
