import type { ThinkingOption } from "../../../core/types";

interface MessageComposerProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  files: File[];
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onFilesChange: (files: File[]) => void;
  onSend: () => Promise<void>;
}

export function MessageComposer({
  message,
  thinking,
  busy,
  files,
  onMessageChange,
  onThinkingChange,
  onFilesChange,
  onSend,
}: MessageComposerProps) {
  return (
    <div className="session-composer">
      <div className="session-composer-toolbar">
        <label className="session-composer-field">
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
        <label className="session-composer-field session-file-picker">
          <span className="eyebrow">Attachments</span>
          <input
            type="file"
            multiple
            onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
          />
        </label>
      </div>
      <textarea
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        placeholder="Continue the session…"
      />
      <div className="session-composer-footer">
        <span className="muted">
          {files.length > 0
            ? `${files.length} attachment${files.length === 1 ? "" : "s"}`
            : "No attachments"}
        </span>
        <button type="button" className="primary" disabled={busy} onClick={() => void onSend()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
