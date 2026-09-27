/**
 * How a stored session changes: a turn starting and ending, a question
 * pending, a restart, a rewind, new options. Records stay plain JSON (the
 * SessionStore reads and writes them whole); every change to their state goes
 * through these functions, so the rules for it live in one place. See
 * `.claude/topics/session-state.md`.
 */

import {
  type InputRequest,
  type SessionAttachment,
  type SessionInput,
  type StoredSession,
  UNTITLED_SESSION_TITLE,
} from "@scholaraio-hub/shared";
import type { SessionRecord } from "./SessionStore.js";

/** How much of the first message becomes the session's title. */
const TITLE_LENGTH = 60;

/** The options a user can change on a session. */
export type SessionOptions = Pick<
  StoredSession,
  "model" | "permissionMode" | "thinking" | "effort"
>;

/** How a turn ended: stopped by the user or the server, failed, or finished. */
export interface TurnOutcome {
  error?: string;
  interrupted?: boolean;
}

/**
 * The user's message starts a turn: it leaves the queue, joins the
 * transcript, and names an untitled session.
 */
export function startTurn(
  record: SessionRecord,
  input: SessionInput,
  files: SessionAttachment[],
): void {
  record.queuedMessages = record.queuedMessages?.filter((message) => message.id !== input.id);
  record.messages.push({
    id: input.id,
    role: "user",
    parts: [
      ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
      ...files.map((file) => ({
        type: "file" as const,
        mediaType: file.mediaType,
        filename: file.filename,
        url: file.url,
      })),
    ],
  });
  record.state = "running";
  record.error = undefined;
  record.pendingInput = undefined;
  // This turn starts with the options changed during the last one.
  record.pendingOptions = undefined;
  if (record.title === UNTITLED_SESSION_TITLE)
    record.title =
      input.text.slice(0, TITLE_LENGTH) || files[0]?.filename || UNTITLED_SESSION_TITLE;
}

/** The running turn asks the user something, or no longer does. */
export function setPendingInput(record: SessionRecord, request: InputRequest | undefined): void {
  record.pendingInput = request;
  record.state = request ? "waiting-input" : "running";
}

/** The turn is over. Anything but a clean finish holds the queue until the user resumes it. */
export function endTurn(record: SessionRecord, outcome: TurnOutcome): void {
  record.state = outcome.interrupted ? "interrupted" : outcome.error ? "error" : "idle";
  if (record.state !== "idle") record.queuePaused = true;
  record.error = outcome.error;
  record.pendingInput = undefined;
}

/** The finished turn could not be saved; the session says so instead of looking done. */
export function turnNotSaved(record: SessionRecord): void {
  record.state = "error";
  record.error = "Unable to save this turn. Check available disk space and try again.";
}

/**
 * A record read back after the server stopped: a turn it was running is
 * over, and its queue waits for the user. Returns whether anything changed.
 */
export function recoverAfterRestart(record: SessionRecord): boolean {
  let changed = false;
  if (record.queuedMessages?.length && !record.queuePaused) {
    record.queuePaused = true;
    changed = true;
  }
  if (record.state === "running" || record.state === "waiting-input") {
    record.state = "interrupted";
    record.pendingInput = undefined;
    record.error =
      "The previous turn was interrupted by a service restart. Send a new message to continue.";
    changed = true;
  }
  return changed;
}

/**
 * New options. While a turn runs it keeps the ones it started with; the
 * changed ones are remembered so the next turn picks them up. An empty model
 * or effort means the provider's default.
 */
export function changeOptions(
  record: SessionRecord,
  options: SessionOptions,
  turnRunning: boolean,
): void {
  if (turnRunning) {
    const changed = (Object.keys(options) as Array<keyof SessionOptions>).filter(
      (key) => options[key] !== undefined,
    );
    record.pendingOptions = [...new Set([...(record.pendingOptions ?? []), ...changed])];
  }
  Object.assign(record, options);
  if (options.model === "") record.model = undefined;
  if (options.effort === "") record.effort = undefined;
}

/**
 * Cut the transcript before the message at `index`, continuing from
 * `nativeSessionId` (a fork of the provider's session that ends there).
 */
export function rewindTo(
  record: SessionRecord,
  index: number,
  nativeSessionId: string | undefined,
): void {
  record.messages = record.messages.slice(0, index);
  record.nativeSessionId = nativeSessionId;
  record.contextUsage = undefined;
  record.error = undefined;
  record.state = "idle";
}
