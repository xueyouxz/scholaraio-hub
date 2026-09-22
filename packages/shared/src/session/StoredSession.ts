import type { UIMessage } from "ai";
import { z } from "zod";
import type { InputRequest } from "../app-types.js";
import type { LibraryCitation } from "../library.js";
import { ATTACHMENT_LIMITS, type PermissionMode, type ThinkingMode } from "../types.js";

/**
 * Something the user should see that is not part of the answer.
 * Stored sessions written before levels existed hold a bare string.
 */
export type SessionNotice = { level: "info" | "error"; text: string };

/** What the hub knows about how an assistant turn was produced. */
export interface SessionMessageMetadata {
  /** The concrete model that answered, as the provider reported it. */
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  contextWindow?: number;
}

/**
 * A running session's state, pushed to open streams whenever it changes, so a
 * pending decision shows without waiting for the next poll. Sent transient:
 * it is never stored in a message or replayed.
 */
export type SessionStatePush = Pick<StoredSession, "state" | "pendingInput">;

export type SessionMessage = UIMessage<
  SessionMessageMetadata,
  {
    citations: LibraryCitation[];
    notice: SessionNotice | string;
    "session-state": SessionStatePush;
  }
>;

/** Read a notice part, including the legacy bare-string form (treated as an error). */
export function readNotice(data: SessionNotice | string): SessionNotice {
  return typeof data === "string" ? { level: "error", text: data } : data;
}

/**
 * What the browser receives as a dynamic tool's output.
 *
 * `content` is what the agent saw. `detail` is optional structured data about
 * the result in the Claude Code `tool_use_result` shape (file range read,
 * content written, match counts), whichever provider ran the tool. Tool
 * failures travel here too, with `isError`, so renderers keep the output of a
 * failed command instead of a bare error string.
 */
export interface ToolOutput {
  content: unknown;
  isError: boolean;
  detail?: unknown;
}

/**
 * Read a dynamic tool part's output. Stored sessions written before the
 * envelope existed hold the raw content (or, for failures, only an error text).
 */
export function readToolOutput(output: unknown, errorText?: string): ToolOutput {
  if (errorText !== undefined) return { content: errorText, isError: true };
  if (
    output &&
    typeof output === "object" &&
    "content" in output &&
    typeof (output as { isError?: unknown }).isError === "boolean"
  ) {
    return output as ToolOutput;
  }
  return { content: output, isError: false };
}
export interface SessionAttachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  url: string;
}
export interface SessionFileContent {
  content?: string;
  rawUrl: string;
  truncated: boolean;
}
export interface StoredSession {
  id: string;
  title: string;
  provider: "claude" | "codex";
  model?: string;
  permissionMode?: PermissionMode;
  thinking?: ThinkingMode;
  /** One of the model's `efforts` ids; unset means the provider's default. */
  effort?: string;
  /** Options changed while a turn was running; they take effect when the next turn starts. */
  pendingOptions?: Array<"model" | "permissionMode" | "thinking" | "effort">;
  paperIds: string[];
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
  state: "idle" | "running" | "waiting-input" | "interrupted" | "error";
  error?: string;
  pendingInput?: InputRequest;
  messages: SessionMessage[];
  queuedMessages?: SessionInput[];
  queuePaused?: boolean;
}
export const SessionOptionsSchema = z.object({
  model: z.string().max(200).optional(),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]).optional(),
  thinking: z.enum(["off", "adaptive"]).optional(),
  /** "" returns to the provider's default effort. */
  effort: z
    .string()
    .regex(/^[a-z0-9_-]{0,40}$/)
    .optional(),
});
export const CreateSessionSchema = SessionOptionsSchema.extend({
  provider: z.enum(["claude", "codex"]),
  model: z.string().max(200).optional(),
  paperIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  projectId: z.string().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(200).default("新会话"),
});
export const SendSessionMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().trim().max(50000),
    attachmentIds: z.array(z.string().uuid()).max(ATTACHMENT_LIMITS.maxCount).default([]),
  })
  .refine(
    (input) => input.text.length > 0 || input.attachmentIds.length > 0,
    "请输入内容或添加附件",
  );
export type SessionInput = z.infer<typeof SendSessionMessageSchema>;

/**
 * The tool call whose subagent produced this part, or undefined for the main
 * agent. The server writes it into `toolMetadata` on tool parts and into
 * `providerMetadata.hub` on text and reasoning parts.
 */
export function parentCallIdOf(part: SessionMessage["parts"][number]): string | undefined {
  const holder =
    part.type === "dynamic-tool"
      ? (part as { toolMetadata?: unknown }).toolMetadata
      : part.type === "text" || part.type === "reasoning"
        ? (part.providerMetadata as { hub?: unknown } | undefined)?.hub
        : undefined;
  const parent = (holder as { parentCallId?: unknown } | undefined)?.parentCallId;
  return typeof parent === "string" ? parent : undefined;
}
