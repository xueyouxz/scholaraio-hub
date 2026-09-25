import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult:
    | ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Options {
  /** Called with the newly-finalized transcript fragment (delta only). */
  onFinalTranscript?: (transcript: string) => void;
  /** Called with the in-progress interim transcript while user is speaking. */
  onInterimTranscript?: (transcript: string) => void;
}

/**
 * Web Speech Recognition hook. Computes deltas between cumulative final
 * results so callbacks receive only the newly-spoken fragment, matching
 * the temp/client behavior. Callbacks are stored in refs so a long-running
 * recognition session always invokes the latest closure (avoids stale state).
 */
export function useSpeechRecognition({ onFinalTranscript, onInterimTranscript }: Options = {}) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppingRef = useRef(false);
  const lastFinalRef = useRef("");

  const onFinalRef = useRef(onFinalTranscript);
  const onInterimRef = useRef(onInterimTranscript);
  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
    onInterimRef.current = onInterimTranscript;
  }, [onFinalTranscript, onInterimTranscript]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition not supported");
      return;
    }
    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;

    stoppingRef.current = false;
    lastFinalRef.current = "";

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      if (stoppingRef.current) return;
      let interim = "";
      let latestFinal = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) latestFinal = transcript;
        else interim += transcript;
      }

      const trimmedInterim = interim.trim();
      setInterimTranscript(trimmedInterim);
      onInterimRef.current?.(trimmedInterim);

      if (latestFinal) {
        const delta = computeDelta(latestFinal, lastFinalRef.current).trim();
        if (delta) {
          lastFinalRef.current = latestFinal;
          setInterimTranscript("");
          onInterimRef.current?.("");
          onFinalRef.current?.(delta);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(event.error);
    };

    recognition.onend = () => {
      if (!stoppingRef.current && recognitionRef.current === recognition) {
        try {
          recognition.start();
          return;
        } catch {
          // fall through to idle
        }
      }
      setListening(false);
      setInterimTranscript("");
      onInterimRef.current?.("");
    };

    recognitionRef.current = recognition;
    setError(null);
    try {
      recognition.start();
    } catch {
      setError("Failed to start speech recognition");
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
    setInterimTranscript("");
    onInterimRef.current?.("");
  }, []);

  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      recognitionRef.current?.abort();
    };
  }, []);

  return { supported, listening, interimTranscript, error, start, stop };
}

/** Strip the prefix shared with the previous cumulative final transcript. */
function computeDelta(latest: string, previous: string): string {
  if (!previous) return latest;
  if (latest.startsWith(previous)) return latest.slice(previous.length);
  // Fallback: find the longest common prefix
  let i = 0;
  const max = Math.min(latest.length, previous.length);
  while (i < max && latest[i] === previous[i]) i++;
  return latest.slice(i);
}
