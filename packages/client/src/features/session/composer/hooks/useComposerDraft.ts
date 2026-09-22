import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";

const draftStorageKey = (draftKey: string) => `hub-composer:${draftKey}`;

export function readComposerDraft(draftKey: string): string {
  try {
    return sessionStorage.getItem(draftStorageKey(draftKey)) ?? "";
  } catch (error) {
    console.warn("无法读取会话草稿", error);
    return "";
  }
}

function writeComposerDraft(draftKey: string, text: string) {
  try {
    if (text) sessionStorage.setItem(draftStorageKey(draftKey), text);
    else sessionStorage.removeItem(draftStorageKey(draftKey));
  } catch (error) {
    console.warn("无法保存会话草稿", error);
  }
}

/**
 * The composer's text, persisted per draft key for the browser session. A parent
 * may own the text (`controlled`), in which case the stored draft is not read here.
 */
export function useComposerDraft(
  draftKey: string,
  controlled?: { text: string | undefined; onTextChange?: Dispatch<SetStateAction<string>> },
) {
  const [innerText, setInnerText] = useState(() =>
    controlled?.text === undefined ? readComposerDraft(draftKey) : "",
  );
  const text = controlled?.text ?? innerText;
  const setText = controlled?.onTextChange ?? setInnerText;
  useEffect(() => writeComposerDraft(draftKey, text), [draftKey, text]);
  /** Drop the stored draft now; the composer may unmount before the next effect runs. */
  const forget = useCallback(() => writeComposerDraft(draftKey, ""), [draftKey]);
  return { text, setText, forget };
}
