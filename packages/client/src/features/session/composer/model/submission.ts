/** Append dictated text to the draft with a single separating space. */
export function appendTranscript(text: string, transcript: string): string {
  return `${text.trimEnd()} ${transcript}`.trimStart();
}

/** What the textarea displays while dictation is still in progress. */
export function withInterim(body: string, interim: string): string {
  return interim ? `${body.trimEnd()} ${interim}`.trimStart() : body;
}

export function hasContent(text: string, interim: string, attachmentCount: number): boolean {
  return !!(text + interim).trim() || attachmentCount > 0;
}

export type SubmissionRoute = "send" | "queue";

/**
 * Where a submission goes. While a turn runs everything is queued; an explicit
 * queue request (Ctrl+Enter / queue button) needs a queue action to exist.
 */
export function routeSubmission(input: {
  running: boolean;
  wantsQueue: boolean;
  canQueue: boolean;
}): SubmissionRoute | null {
  if (input.wantsQueue || input.running) return input.canQueue ? "queue" : null;
  return "send";
}

/**
 * What Enter does. On touch devices Enter is the soft keyboard's newline and
 * sending is the button's job; elsewhere Enter sends, Shift+Enter breaks the
 * line and Ctrl+Enter queues.
 */
export function enterAction(input: {
  shiftKey: boolean;
  ctrlKey: boolean;
  touch: boolean;
}): "newline" | "send" | "queue" {
  if (input.shiftKey) return "newline";
  if (input.ctrlKey) return "queue";
  return input.touch ? "newline" : "send";
}

/** Whether the primary pointer is a finger (phones, tablets). */
export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}
