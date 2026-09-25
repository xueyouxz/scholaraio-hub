import type { InputRequest, ProviderName, SessionMessage } from "@scholaraio-hub/shared";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary";
import { AssistantTurn } from "./AssistantTurn";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { type PromptActions, UserPrompt } from "./UserPrompt";

export interface QueuedMessageView {
  id: string;
  text: string;
}

/**
 * The transcript: user prompts on the right, assistant turns below them, then
 * messages queued behind the running turn, closed by the agent's mark.
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
  provider,
  promptActions,
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
  provider: ProviderName;
  /** Copy is always offered; edit and fork only where the session allows them. */
  promptActions?: PromptActions;
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
              <UserPrompt message={message} {...promptActions} />
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
        <div key={message.id} className="queued-message">
          <div className="message-user-prompt queued-message-bubble">{message.text}</div>
          <div className="queued-message-footer">
            <span className="queued-message-status">
              {queuePaused ? "Paused" : index === 0 ? "Queued (next)" : `Queued (#${index + 1})`}
            </span>
            {onCancelQueued ? (
              <button
                type="button"
                className="queued-message-cancel"
                onClick={() => onCancelQueued(message.id)}
                aria-label={`移除排队消息 ${message.text}`}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {messages.length || processing ? (
        <ProcessingIndicator
          isProcessing={processing}
          provider={provider}
          lastFinishedAt={
            [...messages].reverse().find((message) => message.role === "assistant")?.metadata
              ?.finishedAt
          }
        />
      ) : null}
    </div>
  );
}
