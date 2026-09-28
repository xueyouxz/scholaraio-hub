import type { UIMessage } from "ai";
import { z } from "zod";
import type { LibraryCitation } from "../library.js";
import {
  ATTACHMENT_LIMITS,
  PROVIDER_NAMES,
  type PermissionMode,
  type ProviderName,
  type ThinkingMode,
} from "../types.js";

/**
 * A question the agent is waiting on: a tool approval, or a question for the user.
 */
export interface InputRequest {
  id: string;
  sessionId: string;
  type: "tool-approval" | "question" | "choice";
  prompt: string;
  options?: string[];
  toolName?: string;
  toolInput?: unknown;
  /**
   * The tool call this request is about, when the provider says so, so the UI
   * can ask inline on that call's row instead of in a detached panel.
   */
  toolCallId?: string;
  timestamp: string;
}

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
  /** How long the turn ran, from the prompt being taken to its last event. */
  durationMs?: number;
  /** When the turn ended (ISO 8601). */
  finishedAt?: string;
}

/**
 * A running session's state, pushed to open streams whenever it changes, so a
 * pending decision shows without waiting for the next poll. Sent transient:
 * it is never stored in a message or replayed.
 */
export type SessionStatePush = Pick<SessionDetail, "state" | "pendingInput">;

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
/**
 * How full the model's context window is, as the provider itself counts it:
 * Claude Code's `/context` share used, or Codex's "% context left".
 */
export interface SessionContextUsage {
  /** Tokens occupying the context window. */
  usedTokens: number;
  contextWindow: number;
  /** 0–100 in the direction `display` names. */
  percent: number;
  display: "used" | "remaining";
  /** Claude: token count at which it compacts automatically, when enabled. */
  autoCompactThreshold?: number;
}
/** Literature a session refers to: a whole collection, or one paper. */
export const LiteratureRefSchema = z
  .object({ kind: z.enum(["collection", "paper"]), id: z.string().min(1).max(200) })
  .strict();
export type LiteratureRef = z.infer<typeof LiteratureRefSchema>;
/** How many references a session may hold. */
export const MAX_REFERENCES = 50;
const References = z.array(LiteratureRefSchema).max(MAX_REFERENCES);

/**
 * A session's id throughout the Hub: its provider and the provider's own id
 * for it (Claude's session id, Codex's thread id), as `claude:<id>`.
 */
export function sessionKey(provider: ProviderName, nativeId: string): string {
  return `${provider}:${nativeId}`;
}

/** The provider and native id a session id stands for; undefined for one that is not a session id. */
export function parseSessionKey(
  key: string,
): { provider: ProviderName; nativeId: string } | undefined {
  const at = key.indexOf(":");
  const provider = key.slice(0, at);
  const nativeId = key.slice(at + 1);
  if (at < 0 || !(PROVIDER_NAMES as readonly string[]).includes(provider)) return undefined;
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(nativeId)) return undefined;
  return { provider: provider as ProviderName, nativeId };
}

/** Where a session is: idle, running a turn, waiting on the user, or stopped short. */
export type SessionState = "idle" | "running" | "waiting-input" | "interrupted" | "error";

/**
 * A session as the Hub shows it: the conversation its provider keeps, with
 * what the Hub adds (the literature it refers to, citations, the queue).
 */
export interface SessionDetail {
  /** The session's id: `sessionKey(provider, nativeId)`. */
  id: string;
  provider: ProviderName;
  /** The provider's own id for the session. */
  nativeId: string;
  /** The project it runs in; absent for a session that belongs to no project. */
  projectId?: string;
  /** The directory it runs in. */
  cwd: string;
  title: string;
  model?: string;
  permissionMode?: PermissionMode;
  thinking?: ThinkingMode;
  /** One of the model's `efforts` ids; unset means the provider's default. */
  effort?: string;
  /** Context window fill after the last turn, as the provider reported it. */
  contextUsage?: SessionContextUsage;
  /** Options changed while a turn was running; they take effect when the next turn starts. */
  pendingOptions?: Array<"model" | "permissionMode" | "thinking" | "effort">;
  /** The literature each turn is answered from. */
  references: LiteratureRef[];
  createdAt: string;
  updatedAt: string;
  state: SessionState;
  error?: string;
  pendingInput?: InputRequest;
  messages: SessionMessage[];
  queuedMessages?: SessionInput[];
  queuePaused?: boolean;
  /** Another program (a CLI in a terminal) wrote to it within the last half minute. */
  external?: boolean;
}
/** The title a session has until its first message names it. */
export const UNTITLED_SESSION_TITLE = "新会话";

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
const SessionInputFields = z.object({
  id: z.string().min(1).max(200),
  text: z.string().trim().max(50000),
  attachmentIds: z.array(z.string().uuid()).max(ATTACHMENT_LIMITS.maxCount).default([]),
  /** Literature this message refers to (`@`); the session keeps referring to it. */
  references: References.default([]),
});
const hasContent = (input: { text: string; attachmentIds: string[] }) =>
  input.text.length > 0 || input.attachmentIds.length > 0;
const EMPTY_MESSAGE = "Enter a message or attach a file";

export const SendSessionMessageSchema = SessionInputFields.refine(hasContent, EMPTY_MESSAGE);
export type SessionInput = z.infer<typeof SendSessionMessageSchema>;

/**
 * A new session and its first message, sent together: the provider names the
 * session once it has started it. Draft uploads named in the message move into it.
 */
export const CreateSessionSchema = SessionOptionsSchema.extend({
  provider: z.enum(PROVIDER_NAMES),
  /** The directory to run in; a session without one gets a folder of its own. */
  cwd: z.string().trim().min(1).max(4096).optional(),
  /** Literature the session refers to from the start. */
  references: References.default([]),
  message: SendSessionMessageSchema,
});

/**
 * A message sent to the chat. `replaces` names the session's last prompt when
 * this message corrects it: that turn is taken back and this one runs instead.
 */
export const ChatMessageSchema = SessionInputFields.extend({
  replaces: z.string().min(1).max(200).optional(),
}).refine(hasContent, EMPTY_MESSAGE);
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;

/** What a user may change about a session besides how it runs. */
export const SessionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    /** An archived session is left out of the lists; nothing on disk changes. */
    archived: z.boolean().optional(),
  })
  .strict();

/** The literature a session refers to, as a whole. */
export const SessionReferencesSchema = z.object({ references: References }).strict();

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
