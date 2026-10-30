import type { ProviderName } from "@scholaraio-hub/shared";
import { memo, useEffect, useMemo, useState } from "react";
import { relativeTime } from "../../../shared/format";
import { ProviderLogo } from "../../../shared/ui/ProviderLogo";
import { formatDuration } from "./AssistantTurn";

const PROCESSING_PHRASES = [
  "Thinking...",
  "Processing...",
  "Cooking...",
  "Analyzing...",
  "Working on it...",
  "Pondering...",
  "Computing...",
  "Crafting...",
  "Mulling it over...",
  "On it...",
  "Crunching...",
  "Brewing...",
  "Conjuring...",
  "Synthesizing...",
  "Deliberating...",
  "Ruminating...",
  "Contemplating...",
  "Percolating...",
  "Cogitating...",
  "Noodling...",
];

const ROTATION_INTERVAL_MS = 2000;
const TYPEWRITER_SPEED_MS = 25; // ~40 chars/second = ~240 WPM

/** Fisher-Yates shuffle */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j] as T;
    result[j] = temp as T;
  }
  return result;
}

interface Props {
  isProcessing: boolean;
  /** Whose mark closes the transcript. */
  provider: ProviderName;
  /** When the last turn ended (ISO 8601), shown as "5分钟前" while idle. */
  lastFinishedAt?: string;
}

/**
 * The end of the transcript: the agent's mark, breathing with a rotating
 * phrase while it works and resting once it is done.
 */
export const ProcessingIndicator = memo(function ProcessingIndicator({
  isProcessing,
  provider,
  lastFinishedAt,
}: Props) {
  const elapsed = useElapsedSeconds(isProcessing);
  const now = useNow(!isProcessing && !!lastFinishedAt);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  // A fresh order each time processing starts; idle shows no phrase.
  const phrases = useMemo(
    () => (isProcessing ? shuffle(PROCESSING_PHRASES) : PROCESSING_PHRASES),
    [isProcessing],
  );

  // Rotate phrases
  useEffect(() => {
    if (!isProcessing) {
      setPhraseIndex(0);
      setDisplayedText("");
      setIsTyping(true);
      return;
    }

    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % phrases.length);
      setIsTyping(true);
      setDisplayedText("");
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isProcessing, phrases.length]);

  // Typewriter effect
  useEffect(() => {
    if (!isProcessing || !isTyping) return;

    const phrase = phrases[phraseIndex] ?? "";
    if (displayedText.length >= phrase.length) {
      setIsTyping(false);
      return;
    }

    const timeout = setTimeout(() => {
      setDisplayedText(phrase.slice(0, displayedText.length + 1));
    }, TYPEWRITER_SPEED_MS);

    return () => clearTimeout(timeout);
  }, [isProcessing, isTyping, phraseIndex, displayedText, phrases]);

  return (
    <div className={`processing-indicator${isProcessing ? " active" : ""}`}>
      <span className="processing-mark">
        <ProviderLogo provider={provider} size={18} />
      </span>
      {isProcessing ? (
        <>
          <span className="processing-text">
            {displayedText}
            <span className="processing-cursor">|</span>
          </span>
          <span className="processing-meta">{formatDuration(elapsed * 1000)}</span>
        </>
      ) : lastFinishedAt ? (
        <time
          className="processing-meta"
          dateTime={lastFinishedAt}
          title={`上次运行：${new Date(lastFinishedAt).toLocaleString()}`}
        >
          {relativeTime(lastFinishedAt, now)}
        </time>
      ) : null}
    </div>
  );
});

/** Whole seconds since `running` turned true; 0 while not running. */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  return elapsed;
}

/** The current time, refreshed every half minute while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
