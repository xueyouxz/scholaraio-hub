import type { InputRequest, SessionMessage } from "@scholaraio-hub/shared";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary";
import { AssistantTurn } from "./AssistantTurn";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { UserPrompt } from "./UserPrompt";

export interface QueuedMessageView {
  id: string;
  text: string;
}

/**
 * The transcript: user prompts on the right, assistant turns on a timeline,
 * then messages queued behind the running turn.
 */
export function SessionMessages({
  messages,
  streaming,
  processing = streaming,
  queued = [],
  queuePaused = false,
  onCancelQueued,
  pendingInput,
  sessionId,
  onInputDone,
}: {
  messages: SessionMessage[];
  streaming: boolean;
  processing?: boolean;
  queued?: QueuedMessageView[];
  queuePaused?: boolean;
  onCancelQueued?: (id: string) => void;
  /** A decision the agent is waiting on; asked on its tool call's row when it has one. */
  pendingInput?: InputRequest;
  sessionId?: string;
  onInputDone?: () => void;
}) {
  return (
    <div className="message-list">
      {messages.map((message, index) => {
        const last = index === messages.length - 1;
        return (
          <ErrorBoundary
            key={message.id}
            resetKey={message}
            fallback={(error) => (
              <div role="alert" className="text-block render-error">
                无法显示这条消息：{error.message}
              </div>
            )}
          >
            {message.role === "user" ? (
              <UserPrompt message={message} />
            ) : (
              <AssistantTurn
                message={message}
                streaming={streaming && last}
                pendingInput={last ? pendingInput : undefined}
                sessionId={sessionId}
                onInputDone={onInputDone}
              />
            )}
          </ErrorBoundary>
        );
      })}
      {queued.map((message, index) => (
        <div key={message.id} className="deferred-message">
          <div className="message-user-prompt deferred-message-bubble">{message.text}</div>
          <div className="deferred-message-footer">
            <span className="deferred-message-status">
              {queuePaused ? "Paused" : index === 0 ? "Queued (next)" : `Queued (#${index + 1})`}
            </span>
            {onCancelQueued ? (
              <button
                type="button"
                className="deferred-message-cancel"
                onClick={() => onCancelQueued(message.id)}
                aria-label={`移除排队消息 ${message.text}`}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <ProcessingIndicator isProcessing={processing} />
    </div>
  );
}
