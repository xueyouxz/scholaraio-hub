import type { InputRequest, PermissionMode, ProviderName } from "../types";

export type StreamMessagePayload = Record<string, unknown>;

export interface DeferredQueueMessage {
  tempId?: string;
  content: string;
  timestamp: string;
}

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
  | { eventType: "session-id-changed"; oldSessionId?: string; newSessionId?: string }
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
    case "message":
      return { eventType, message: payload };
    case "connected":
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
    case "status":
      return {
        eventType,
        state: asNonEmptyString(payload.state),
        request: asInputRequest(payload.request),
      };
    case "mode-change":
      return {
        eventType,
        permissionMode: asPermissionMode(payload.permissionMode),
        modeVersion: asNumber(payload.modeVersion),
      };
    case "markdown-augment":
      return {
        eventType,
        blockIndex: asNumber(payload.blockIndex),
        html: asString(payload.html),
        type: asNonEmptyString(payload.type),
        messageId: asNonEmptyString(payload.messageId),
      };
    case "pending":
      return {
        eventType,
        html: asString(payload.html),
        messageId: asNonEmptyString(payload.messageId),
      };
    case "deferred-queue":
      return {
        eventType,
        messages: asDeferredMessages(payload.messages),
      };
    case "complete":
      return {
        eventType,
        timestamp: asNonEmptyString(payload.timestamp),
      };
    case "session-id-changed":
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
