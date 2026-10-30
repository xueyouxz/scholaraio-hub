import type { Dispatch, SetStateAction } from "react";

/**
 * A menu of completions for the token at the caret (`/command`, `@paper`),
 * steered from the textarea's keys. Each picker decides what triggers it and
 * where its items come from; the keys work the same for all of them.
 */
export interface Typeahead<T> {
  /** The menu is showing. */
  open: boolean;
  items: readonly T[];
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  /** Hide the menu until the user types again. */
  dismiss(): void;
}

/** The keys of a textarea keydown a typeahead reads. */
interface Keystroke {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}

/**
 * Apply a key to an open menu: arrows, Home and End move, Escape closes, and
 * Enter or Tab picks the active item. Returns whether the menu took the key,
 * in which case the textarea must not act on it.
 */
export function typeaheadKey<T>(
  keystroke: Keystroke,
  typeahead: Typeahead<T>,
  pick: (item: T) => void,
): boolean {
  if (!typeahead.open) return false;
  const { key } = keystroke;
  const count = typeahead.items.length;
  if (key === "Escape") {
    typeahead.dismiss();
    return true;
  }
  if (!count) return false;
  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    typeahead.setActiveIndex((index) => (index + step + count) % count);
    return true;
  }
  if (key === "Home" || key === "End") {
    typeahead.setActiveIndex(key === "Home" ? 0 : count - 1);
    return true;
  }
  if ((key === "Enter" && !keystroke.shiftKey && !keystroke.ctrlKey) || key === "Tab") {
    const item = typeahead.items[typeahead.activeIndex] ?? typeahead.items[0];
    if (item === undefined) return false;
    pick(item);
    return true;
  }
  return false;
}
