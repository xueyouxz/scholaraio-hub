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
 * The composer's one action button. What it does follows the session: send a
 * message, queue it while a turn runs, or stop that turn when there is nothing
 * to send.
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
  const canStop = hasStopAction && isRunning && isThinking;
  const action = busy
    ? "busy"
    : isRunning && canSend && hasQueueAction
      ? "queue"
      : canStop && !canSend
        ? "stop"
        : "send";

  const label =
    action === "busy"
      ? "Sending…"
      : action === "queue"
        ? "Queue message"
        : action === "stop"
          ? "Stop"
          : "Send";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={action === "busy" || (action === "send" && !canSend)}
      onClick={() => {
        if (action === "stop") onStop?.();
        else if (action === "queue") onQueue?.();
        else onSend();
      }}
      className={`hub-composer-send w-9 h-9 flex items-center justify-center rounded-full transition active:scale-95 disabled:bg-surface-container-high disabled:text-on-surface-variant/40 disabled:shadow-none ${
        action === "stop"
          ? "bg-error text-on-error hover:brightness-110"
          : "bg-[var(--composer-accent)] text-on-primary shadow-sm hover:brightness-110"
      }`}
    >
      {action === "busy" ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : action === "stop" ? (
        <Square size={10} fill="currentColor" aria-hidden="true" />
      ) : action === "queue" ? (
        <ListPlus size={16} aria-hidden="true" />
      ) : (
        <ArrowUp size={17} strokeWidth={2.5} aria-hidden="true" />
      )}
    </button>
  );
}
