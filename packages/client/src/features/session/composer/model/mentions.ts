import type { LiteratureRef } from "@scholaraio-hub/shared";

/** An `@query` being typed: its span in the text and what follows the `@` up to the caret. */
export interface MentionToken {
  start: number;
  end: number;
  query: string;
}

/**
 * The `@word` the caret is in or right after, if any. A mention counts only at
 * the start of the text or after whitespace, so addresses like `a@b.c` never trigger.
 */
export function mentionTokenAt(text: string, caret: number): MentionToken | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--;
  if (text[start] !== "@") return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end] ?? "")) end++;
  return { start, end, query: text.slice(start + 1, caret) };
}

/** One thing an `@` can refer to, as the menu lists it. */
export interface MentionOption {
  ref: LiteratureRef;
  /** What the message shows after `@`, and the menu's main line. */
  label: string;
  /** A second line: a collection's size, a paper's authors and year. */
  detail?: string;
}

/** What choosing `option` puts in place of the token: `@name ` with spaces kept readable. */
export function mentionReplacement(option: MentionOption): string {
  return `@${option.label.replace(/\s+/g, "_")} `;
}
