import { useCallback, useState } from "react";
import { UI_KEYS } from "../lib/storageKeys";

function loadFunPhrasesEnabled(): boolean {
  const stored = localStorage.getItem(UI_KEYS.funPhrases);
  if (stored === null) return true;
  return stored === "true";
}

function saveFunPhrasesEnabled(enabled: boolean) {
  localStorage.setItem(UI_KEYS.funPhrases, String(enabled));
}

export function useFunPhrases() {
  const [funPhrasesEnabled, setFunPhrasesEnabledState] = useState<boolean>(loadFunPhrasesEnabled);

  const setFunPhrasesEnabled = useCallback((enabled: boolean) => {
    setFunPhrasesEnabledState(enabled);
    saveFunPhrasesEnabled(enabled);
  }, []);

  return { funPhrasesEnabled, setFunPhrasesEnabled };
}

export function getFunPhrasesEnabled(): boolean {
  return loadFunPhrasesEnabled();
}
