/**
 * Session stream event contract (SSE).
 *
 * Single source of truth for the events the server emits on
 * `GET /api/sessions/:id/stream` and that the client parses. Both ends import
 * from here so a renamed/added event surfaces as a compile error on both sides
 * instead of silently drifting.
 *
 * The wire shape is `event: <name>\ndata: <json>`; the JSON payloads are the
 * `data` portion described by `SessionStreamEvent` below. `message` payloads are
 * raw provider/SDK messages and are passed through untyped on purpose.
 */

import type { InputRequest } from "./app-types.js";
import type { PermissionMode, ProviderName } from "./types.js";

/**
 * Canonical event names. Use these constants when emitting/parsing instead of
 * bare string literals so the two ends stay coupled at compile time.
 */
export const SESSION_STREAM_EVENT = {
  connected: "connected",
  message: "message",
  status: "status",
  modeChange: "mode-change",
  markdownAugment: "markdown-augment",
  pending: "pending",
  deferredQueue: "deferred-queue",
  sessionIdChanged: "session-id-changed",
  complete: "complete",
  /** Transport-level signals — emitted but not part of the structured union. */
  error: "error",
  heartbeat: "heartbeat",
} as const;

export type SessionStreamEventName =
  (typeof SESSION_STREAM_EVENT)[keyof typeof SESSION_STREAM_EVENT];

/** Raw provider/SDK message body, passed through without reshaping. */
export type StreamMessagePayload = Record<string, unknown>;

/** A message queued server-side, waiting for the agent's turn to end. */
export interface DeferredQueueMessage {
  tempId?: string;
  content: string;
  timestamp: string;
}

/**
 * Discriminated union of structured events carried over the session stream.
 *
 * Excludes `heartbeat` (handled purely as a liveness ping by the transport) and
 * `error` (transport-level; not a structured payload). The client adds an
 * `unknown` fallback variant on top of this for forward compatibility.
 */
export type SessionStreamEvent =
  | { eventType: "message"; message: StreamMessagePayload }
  | {
      eventType: "connected";
      sessionId?: string;
      state?: string;
      permissionMode?: PermissionMode;
      modeVersion?: number;
      request?: InputRequest;
      provider?: ProviderName;
      model?: string;
      deferredMessages?: DeferredQueueMessage[];
    }
  | { eventType: "status"; state?: string; request?: InputRequest }
  | { eventType: "mode-change"; permissionMode?: PermissionMode; modeVersion?: number }
  | {
      eventType: "markdown-augment";
      blockIndex?: number;
      html?: string;
      type?: string;
      messageId?: string;
    }
  | { eventType: "pending"; html?: string; messageId?: string }
  | { eventType: "deferred-queue"; messages: DeferredQueueMessage[] }
  | { eventType: "complete"; timestamp?: string }
  | { eventType: "session-id-changed"; oldSessionId?: string; newSessionId?: string };
