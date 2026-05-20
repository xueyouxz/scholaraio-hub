import { Mic } from "lucide-react";
import { type ForwardedRef, forwardRef, useCallback, useImperativeHandle } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

export interface VoiceInputButtonRef {
  stopAndFinalize: () => string;
  toggle: () => void;
  isListening: boolean;
  isAvailable: boolean;
}

interface VoiceInputButtonProps {
  onFinalTranscript: (transcript: string) => void;
  onInterimTranscript: (transcript: string) => void;
  onListeningStart?: () => void;
  disabled?: boolean;
}

export const VoiceInputButton = forwardRef(function VoiceInputButton(
  { onFinalTranscript, onInterimTranscript, onListeningStart, disabled }: VoiceInputButtonProps,
  ref: ForwardedRef<VoiceInputButtonRef>,
) {
  const speech = useSpeechRecognition({
    onFinalTranscript,
    onInterimTranscript,
  });

  const toggle = useCallback(() => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    onListeningStart?.();
    speech.start();
  }, [onListeningStart, speech]);

  useImperativeHandle(
    ref,
    () => ({
      stopAndFinalize: () => {
        const pending = speech.interimTranscript.trim();
        if (speech.listening) {
          speech.stop();
        }
        return pending;
      },
      toggle,
      isListening: speech.listening,
      isAvailable: speech.supported,
    }),
    [speech, toggle],
  );

  if (!speech.supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={speech.error ?? (speech.listening ? "Stop voice input" : "Start voice input")}
      aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
      aria-pressed={speech.listening}
      className={`p-1.5 rounded-lg transition-colors text-on-surface-variant hover:bg-surface-container hover:text-on-surface ${
        speech.listening ? "bg-error/10 text-error hover:bg-error/20" : ""
      }`}
    >
      <Mic size={13} aria-hidden="true" />
    </button>
  );
});
