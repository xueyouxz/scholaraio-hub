/**
 * The Claude Agent SDK's wire messages, as far as the Hub reads them.
 *
 * Only valid on the provider side of the adapter boundary: the Claude provider
 * reads them, `ClaudeEventAdapter` translates them into AgentEvent, and the
 * history importer reads the same shapes from Claude's own transcripts.
 * Loosely typed on purpose — the SDK adds fields between releases and each
 * reader picks what it needs.
 */

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

export interface SDKMessage {
  type: string;
  uuid?: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content: string | ContentBlock[];
    role?: string;
    /** Resolved model name from API response (e.g., "claude-sonnet-4-5-20250929") */
    model?: string;
  };
  /** The subagent call this message belongs to, when a subagent sent it. */
  parent_tool_use_id?: string;
  tool_use_id?: string;
  toolUseResult?: unknown;
  usage?: unknown;
  modelUsage?: unknown;
  error?: unknown;
  // Allow any additional fields from SDK
  [key: string]: unknown;
}
