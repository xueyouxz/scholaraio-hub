import { useEffect, useRef } from "react";

const PREFIX = "scholaraio-hub:draft:";
const SAVE_DEBOUNCE_MS = 250;

export interface DraftControls {
  clearInput: () => void;
  clearDraft: () => void;
  restoreFromStorage: () => string | null;
  clear: () => void;
  restore: () => string | null;
}

interface Options {
  draftKey: string;
  value: string;
  onLoad: (value: string) => void;
}

export function useDraftPersistence({ draftKey, value, onLoad }: Options): DraftControls {
  const hasLoadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const draftKeyRef = useRef(draftKey);

  useEffect(() => {
    draftKeyRef.current = draftKey;
    hasLoadedRef.current = false;
    try {
      const stored = window.localStorage.getItem(`${PREFIX}${draftKey}`);
      if (stored && stored.length > 0) onLoad(stored);
    } catch {
      // localStorage unavailable
    }
    hasLoadedRef.current = true;
  }, [draftKey, onLoad]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        const key = `${PREFIX}${draftKeyRef.current}`;
        if (value.length === 0) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, value);
        }
      } catch {
        // ignore
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [value]);

  return {
    clearInput: () => {
      onLoad("");
    },
    clearDraft: () => {
      onLoad("");
      try {
        window.localStorage.removeItem(`${PREFIX}${draftKeyRef.current}`);
      } catch {
        // ignore
      }
    },
    restoreFromStorage: () => {
      try {
        const stored = window.localStorage.getItem(`${PREFIX}${draftKeyRef.current}`);
        if (stored !== null) {
          onLoad(stored);
        }
        return stored;
      } catch {
        return null;
      }
    },
    clear: () => {
      onLoad("");
      try {
        window.localStorage.removeItem(`${PREFIX}${draftKeyRef.current}`);
      } catch {
        // ignore
      }
    },
    restore: () => {
      try {
        return window.localStorage.getItem(`${PREFIX}${draftKeyRef.current}`);
      } catch {
        return null;
      }
    },
  };
}
