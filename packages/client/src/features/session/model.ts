import type {
  AppSession,
  InputRequest,
  PermissionMode,
  SessionOwnership,
} from "@scholaraio-hub/shared";
import type { SessionDetail } from "../../core/types";

export interface MarkdownAugment {
  html: string;
}

export interface SessionContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | SessionContentBlock[];
  is_error?: boolean;
  _html?: string;
  [key: string]: unknown;
}

export type SessionContent = string | Array<string | SessionContentBlock>;

export interface SessionMessage {
  id?: string;
  uuid?: string;
  type?: string;
  role?: "user" | "assistant" | "system";
  timestamp?: string;
  content?: SessionContent;
  message?: {
    role?: "user" | "assistant";
    content?: SessionContent;
    _html?: string;
    [key: string]: unknown;
  };
  _source?: "sdk" | "jsonl";
  _isStreaming?: boolean;
  _html?: string;
  [key: string]: unknown;
}

export interface SessionPagination {
  hasOlderMessages: boolean;
  totalMessageCount: number;
  returnedMessageCount: number;
  truncatedBeforeMessageId?: string;
  totalCompactions: number;
}

export interface SessionStateSnapshot {
  session: AppSession | null;
  messages: SessionMessage[];
  ownership: SessionOwnership;
  pendingInputRequest: InputRequest | null;
  slashCommands: Array<{ name: string; description?: string }>;
  pagination: SessionPagination | null;
  markdownAugments: Record<string, MarkdownAugment>;
  liveStatus: string | null;
  permissionMode: PermissionMode | null;
  modeVersion: number | null;
}

export function createEmptySessionSnapshot(): SessionStateSnapshot {
  return {
    session: null,
    messages: [],
    ownership: { owner: "none" },
    pendingInputRequest: null,
    slashCommands: [],
    pagination: null,
    markdownAugments: {},
    liveStatus: null,
    permissionMode: null,
    modeVersion: null,
  };
}

export function getMessageId(message: Partial<SessionMessage>): string {
  const uuid = typeof message.uuid === "string" ? message.uuid : undefined;
  if (uuid) return uuid;
  return typeof message.id === "string" ? message.id : "";
}

export function getMessageContent(message: Partial<SessionMessage>): SessionContent | null {
  if (typeof message.content === "string" || Array.isArray(message.content)) {
    return message.content;
  }
  const nested = message.message as { content?: SessionContent } | undefined;
  if (typeof nested?.content === "string" || Array.isArray(nested?.content)) {
    return nested.content;
  }
  return null;
}

export function getMessageRole(
  message: Partial<SessionMessage>,
): "user" | "assistant" | "system" | null {
  if (message.type === "user" || message.type === "assistant" || message.type === "system") {
    return message.type;
  }
  const nested = message.message as { role?: unknown } | undefined;
  if (nested?.role === "user" || nested?.role === "assistant" || nested?.role === "system") {
    return nested.role;
  }
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    return message.role;
  }
  return null;
}

function collectBlockHtml(
  content: SessionContent | null,
  fallbackMessage: Partial<SessionMessage>,
): string | null {
  if (typeof content === "string") {
    const nested = fallbackMessage.message as { _html?: unknown } | undefined;
    if (typeof nested?._html === "string" && nested._html) {
      return nested._html;
    }
    return typeof fallbackMessage._html === "string" ? fallbackMessage._html : null;
  }

  if (!Array.isArray(content)) {
    return typeof fallbackMessage._html === "string" ? fallbackMessage._html : null;
  }

  const html = content
    .filter(
      (block): block is SessionContentBlock =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        typeof block._html === "string" &&
        Boolean(block._html),
    )
    .map((block) => String(block._html))
    .join("\n");

  return html || null;
}

export function collectInitialMarkdownAugments(
  messages: SessionMessage[],
): Record<string, MarkdownAugment> {
  const augments: Record<string, MarkdownAugment> = {};
  for (const message of messages) {
    const id = getMessageId(message);
    if (!id) continue;
    const html = collectBlockHtml(getMessageContent(message), message);
    if (html) {
      augments[id] = { html };
    }
  }
  return augments;
}

export function snapshotFromSessionDetail(detail: SessionDetail): SessionStateSnapshot {
  return {
    session: detail.session,
    messages: detail.messages,
    ownership: detail.ownership,
    pendingInputRequest: detail.pendingInputRequest ?? null,
    slashCommands: detail.slashCommands ?? [],
    pagination: detail.pagination ?? null,
    markdownAugments: collectInitialMarkdownAugments(detail.messages),
    liveStatus: detail.ownership.owner,
    permissionMode:
      detail.ownership.owner === "self" ? (detail.ownership.permissionMode ?? null) : null,
    modeVersion: detail.ownership.owner === "self" ? (detail.ownership.modeVersion ?? null) : null,
  };
}

export function mergeMessages(
  existing: SessionMessage[],
  incoming: SessionMessage[],
): SessionMessage[] {
  const merged = [...existing];

  for (const incomingMessage of incoming) {
    const incomingId = getMessageId(incomingMessage);
    if (!incomingId) {
      merged.push(incomingMessage);
      continue;
    }

    const index = merged.findIndex((message) => getMessageId(message) === incomingId);
    if (index === -1) {
      merged.push(incomingMessage);
      continue;
    }

    merged[index] = {
      ...merged[index],
      ...incomingMessage,
      _source: incomingMessage._source ?? merged[index]?._source,
    };
  }

  return merged;
}
