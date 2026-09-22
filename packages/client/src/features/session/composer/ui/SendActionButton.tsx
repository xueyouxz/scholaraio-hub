import { ArrowUp, ListPlus, Loader2, Square } from "lucide-react";

interface Props {
  busy: boolean;
  canSend: boolean;
  isRunning: boolean;
  isThinking: boolean;
  hasQueueAction: boolean;
  hasStopAction: boolean;
  onSend: () => void;
  onQueue?: () => void;
  onStop?: () => void;
}

/**
 * Renders the right-side send/queue/stop trio.
 *
 * Visibility rules:
 *  - Stop is shown whenever a process is running (isRunning && isThinking).
 *    When the user also has draft content, Stop renders as a secondary button
 *    next to Queue; the primary button reverts to Send.
 *  - Queue is shown when the user has draft content AND a process is running.
 *  - The primary button is Send by default, Stop when there is no draft.
 */
export function SendActionButton({
  busy,
  canSend,
  isRunning,
  isThinking,
  hasQueueAction,
  hasStopAction,
  onSend,
  onQueue,
  onStop,
}: Props) {
  const showStop = hasStopAction && isRunning && isThinking;
  const stopAsSecondary = showStop && canSend;
  const showQueue = hasQueueAction && canSend && isRunning;
  const primaryIsStop = showStop && !canSend;

  return (
    <>
      {stopAsSecondary ? (
        <button
          type="button"
          onClick={onStop}
          title="停止"
          aria-label="停止"
          className="p-1.5 rounded-lg bg-surface-container text-error hover:bg-error/10 transition-colors"
        >
          <Square size={11} aria-hidden="true" />
        </button>
      ) : null}

      {showQueue ? (
        <button
          type="button"
          onClick={onQueue}
          disabled={busy}
          title="加入队列"
          aria-label="加入队列"
          className="p-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
        >
          <ListPlus size={15} aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (primaryIsStop) {
            onStop?.();
            return;
          }
          onSend();
        }}
        disabled={busy || (!canSend && !primaryIsStop)}
        aria-label={primaryIsStop ? "停止" : busy ? "发送中…" : "发送"}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
          primaryIsStop ? "bg-error text-on-error" : "signature-gradient text-on-primary shadow-sm"
        }`}
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        ) : primaryIsStop ? (
          <Square size={11} aria-hidden="true" />
        ) : (
          <ArrowUp size={15} aria-hidden="true" />
        )}
      </button>
    </>
  );
}
