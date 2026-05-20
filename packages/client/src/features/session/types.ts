import type {
  AgentActivity,
  AgentStatus,
  AppSession,
  AppSessionSummary,
  ContextUsage,
  InputRequest,
  PendingInputType,
  PermissionMode,
  ProviderName,
  SessionOwnership,
  UrlProjectId,
} from "@scholaraio-hub/shared";

export interface SessionNavState {
  initialStatus?: { owner: "self"; processId: string };
  initialTitle?: string;
  initialProvider?: ProviderName;
  initialModel?: string;
}

export type {
  AgentActivity,
  AgentStatus,
  AppSession,
  AppSessionSummary,
  ContextUsage,
  InputRequest,
  PendingInputType,
  PermissionMode,
  ProviderName,
  SessionOwnership,
  UrlProjectId,
};

export interface MarkdownAugment {
  html: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  _html?: string;
  [key: string]: unknown;
}

export interface Message {
  id?: string;
  uuid?: string;
  type?: string;
  role?: "user" | "assistant" | "system";
  timestamp?: string;
  content?: string | ContentBlock[];
  message?: {
    role?: "user" | "assistant" | "system";
    content?: string | ContentBlock[];
    _html?: string;
    [key: string]: unknown;
  };
  _source?: "sdk" | "jsonl";
  _isStreaming?: boolean;
  _html?: string;
  parentUuid?: string | null;
  orphanedToolUseIds?: string[];
  toolUseResult?: unknown;
  isReplay?: boolean;
  isSubagent?: boolean;
  session_id?: string;
  [key: string]: unknown;
}
export type SessionStatus = SessionOwnership;
export type SessionSummary = AppSessionSummary;

export interface Session extends AppSessionSummary {
  messages: Message[];
}

export interface AgentSession {
  messages: Message[];
  status: AgentStatus;
}
