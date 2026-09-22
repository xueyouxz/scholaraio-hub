// Core types for Claude SDK abstraction

// Re-export PermissionMode from shared
export type { PermissionMode } from "@scholaraio-hub/shared";
import type { PermissionMode, UploadedFile } from "@scholaraio-hub/shared";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "thinking";
  text?: string;
  /** For thinking blocks */
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  /** For tool_result blocks - references the tool_use id */
  tool_use_id?: string;
  /** For tool_result blocks - the result content */
  content?: string;
}

/**
 * Claude Agent SDK wire message.
 *
 * Only valid on the provider side of the adapter boundary: the Claude provider
 * reads it, `ClaudeEventAdapter` (sdk/providers/claude-events.ts) translates it
 * into AgentEvent, and nothing downstream sees it. Loosely typed on purpose —
 * the SDK adds fields between releases and the adapter picks what it needs.
 */
export interface SDKMessage {
  type: string;
  uuid?: string;
  subtype?: string;
  session_id?: string;
  timestamp?: string;
  message?: {
    content: string | ContentBlock[];
    role?: string;
    /** Resolved model name from API response (e.g., "claude-sonnet-4-5-20250929") */
    model?: string;
  };
  // DAG structure
  parentUuid?: string | null;
  parent_tool_use_id?: string;
  // Message origin flags
  isSynthetic?: boolean;
  isReplay?: boolean;
  userType?: string;
  // Tool use related
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  toolUseResult?: unknown;
  // Input requests (tool approval, questions, etc.)
  input_request?: {
    id: string;
    type: "tool-approval" | "question" | "choice";
    prompt: string;
    options?: string[];
  };
  // Result metadata
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  usage?: unknown;
  modelUsage?: unknown;
  num_turns?: number;
  // Error info
  error?: unknown;
  // Allow any additional fields from SDK
  [key: string]: unknown;
}

export type TimestampedSDKMessage<T extends SDKMessage = SDKMessage> = T & {
  timestamp: string;
};

export interface UserMessage {
  text: string;
  images?: string[]; // base64 or file paths
  documents?: string[];
  /** File attachments with paths for agent to access via Read tool */
  attachments?: UploadedFile[];
  mode?: PermissionMode;
  /** UUID to use for this message. If not provided, SDK will generate one. */
  uuid?: string;
  /** Client-generated temp ID for optimistic UI tracking. Echoed back in SSE. */
  tempId?: string;
}

export interface ToolApprovalResult {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
  /**
   * If true, interrupt execution and do not continue.
   * Set to true when user denies without guidance (just clicks "No").
   * Leave false/unset when user provides feedback for Claude to incorporate.
   */
  interrupt?: boolean;
}

export type CanUseTool = (
  toolName: string,
  input: unknown,
  options: {
    signal: AbortSignal;
    /** The tool call being approved (Claude `toolUseID`, Codex item id). */
    toolUseID?: string;
  },
) => Promise<ToolApprovalResult>;
