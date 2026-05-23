import type { ClaudeSessionEntry } from "../claude-sdk-schema/types.js";
import type { CodexSessionEntry } from "../codex-schema/types.js";

/**
 * Claude session file content - array of JSONL entries.
 * Uses the Zod-validated ClaudeSessionEntry type.
 */
export interface ClaudeSessionFile {
  messages: ClaudeSessionEntry[];
}

// Codex sessions are a series of entries (lines)
export interface CodexSessionContent {
  entries: CodexSessionEntry[];
}

export type UnifiedSession =
  | { provider: "claude"; session: ClaudeSessionFile }
  | { provider: "claude-ollama"; session: ClaudeSessionFile }
  | { provider: "codex"; session: CodexSessionContent }
  | { provider: "codex-oss"; session: CodexSessionContent };
