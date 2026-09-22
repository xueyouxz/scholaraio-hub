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
