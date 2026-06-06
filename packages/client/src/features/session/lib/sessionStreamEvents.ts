import {
  type DeferredQueueMessage,
  SESSION_STREAM_EVENT,
  type StreamMessagePayload,
  type SessionStreamEvent as WireSessionStreamEvent,
} from "@scholaraio-hub/shared";
import type { InputRequest, PermissionMode, ProviderName } from "../types";

export type { DeferredQueueMessage, StreamMessagePayload };

/**
 * Parsed session stream event: the shared wire contract plus a
 * forward-compatible `unknown` fallback for event names this client build does
 * not recognize yet.
 */
export type SessionStreamEvent =
  | WireSessionStreamEvent
  | { eventType: "unknown"; originalEventType: string; payload: Record<string, unknown> };

const PERMISSION_MODES = new Set<PermissionMode>([
  "default",
  "bypassPermissions",
  "acceptEdits",
  "plan",
]);

const PROVIDER_NAMES = new Set<ProviderName>([
  "claude",
  "claude-ollama",
  "codex",
  "codex-oss",
  "gemini",
  "gemini-acp",
  "opencode",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPermissionMode(value: unknown): PermissionMode | undefined {
  return typeof value === "string" && PERMISSION_MODES.has(value as PermissionMode)
    ? (value as PermissionMode)
    : undefined;
}

function asProviderName(value: unknown): ProviderName | undefined {
  return typeof value === "string" && PROVIDER_NAMES.has(value as ProviderName)
    ? (value as ProviderName)
    : undefined;
}

function asInputRequest(value: unknown): InputRequest | undefined {
  return asRecord(value) ? (value as InputRequest) : undefined;
}

function asDeferredMessages(value: unknown): DeferredQueueMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const content = asNonEmptyString(record?.content);
    const timestamp = asNonEmptyString(record?.timestamp);
    const tempId = asNonEmptyString(record?.tempId);
    if (!content || !timestamp) return [];
    return [
      {
        content,
        timestamp,
        ...(tempId ? { tempId } : {}),
      },
    ];
  });
}

export function parseSessionStreamEvent(
  eventType: string,
  payload: Record<string, unknown>,
): SessionStreamEvent {
  switch (eventType) {
    case SESSION_STREAM_EVENT.message:
      return { eventType, message: payload };
    case SESSION_STREAM_EVENT.connected:
      return {
        eventType,
        sessionId: asNonEmptyString(payload.sessionId),
        state: asNonEmptyString(payload.state),
        permissionMode: asPermissionMode(payload.permissionMode),
        modeVersion: asNumber(payload.modeVersion),
        request: asInputRequest(payload.request),
        provider: asProviderName(payload.provider),
        model: asNonEmptyString(payload.model),
        deferredMessages: asDeferredMessages(payload.deferredMessages),
      };
    case SESSION_STREAM_EVENT.status:
      return {
        eventType,
        state: asNonEmptyString(payload.state),
        request: asInputRequest(payload.request),
      };
    case SESSION_STREAM_EVENT.modeChange:
      return {
        eventType,
        permissionMode: asPermissionMode(payload.permissionMode),
        modeVersion: asNumber(payload.modeVersion),
      };
    case SESSION_STREAM_EVENT.markdownAugment:
      return {
        eventType,
        blockIndex: asNumber(payload.blockIndex),
        html: asString(payload.html),
        type: asNonEmptyString(payload.type),
        messageId: asNonEmptyString(payload.messageId),
      };
    case SESSION_STREAM_EVENT.pending:
      return {
        eventType,
        html: asString(payload.html),
        messageId: asNonEmptyString(payload.messageId),
      };
    case SESSION_STREAM_EVENT.deferredQueue:
      return {
        eventType,
        messages: asDeferredMessages(payload.messages),
      };
    case SESSION_STREAM_EVENT.complete:
      return {
        eventType,
        timestamp: asNonEmptyString(payload.timestamp),
      };
    case SESSION_STREAM_EVENT.sessionIdChanged:
      return {
        eventType,
        oldSessionId: asNonEmptyString(payload.oldSessionId),
        newSessionId: asNonEmptyString(payload.newSessionId),
      };
    default:
      return {
        eventType: "unknown",
        originalEventType: eventType,
        payload,
      };
  }
}
