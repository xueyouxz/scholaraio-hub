import { memo, useEffect, useState } from "react";
import { ThinkingIndicator } from "./ThinkingIndicator";

const PHRASES = [
  "Thinking...",
  "Processing...",
  "Analyzing...",
  "Working on it...",
  "Pondering...",
  "Computing...",
  "Crafting...",
];

const ROTATION_MS = 2500;
const TYPEWRITER_MS = 22;

interface Props {
  isProcessing: boolean;
}

export const ProcessingIndicator = memo(function ProcessingIndicator({ isProcessing }: Props) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    if (!isProcessing) {
      setPhraseIndex(0);
      setDisplayed("");
      setTyping(true);
      return;
    }
    const id = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASES.length);
      setDisplayed("");
      setTyping(true);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [isProcessing]);

  useEffect(() => {
    if (!isProcessing || !typing) return;
    const phrase = PHRASES[phraseIndex] ?? "";
    if (displayed.length >= phrase.length) {
      setTyping(false);
      return;
    }
    const id = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), TYPEWRITER_MS);
    return () => clearTimeout(id);
  }, [isProcessing, typing, phraseIndex, displayed]);

  if (!isProcessing) return null;

  return (
    <div className="processing-indicator">
      <div className="processing-dot-container">
        <ThinkingIndicator />
      </div>
      <span className="processing-text">
        {displayed}
        <span className="processing-cursor">|</span>
      </span>
    </div>
  );
});
