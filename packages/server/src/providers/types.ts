// Provider abstraction types for multi-provider support
import type {
  ModelInfo,
  PermissionMode,
  ProviderName,
  ProviderUsageLimits,
  SlashCommand,
  ThinkingConfig,
  UploadedFile,
} from "@scholaraio-hub/shared";
import type { MessageQueue } from "./MessageQueue.js";
import type { AgentEvent } from "./events.js";

/** The Hub's permission modes; the provider translates them into its own policy. */
export type { PermissionMode } from "@scholaraio-hub/shared";

/** A user message on its way to a provider, with the files the user attached. */
export interface UserMessage {
  text: string;
  /** File attachments with paths for agent to access via Read tool */
  attachments?: UploadedFile[];
  /** UUID to use for this message. If not provided, SDK will generate one. */
  uuid?: string;
}

/** The Hub's answer to a provider asking whether a tool call may run. */
export interface ToolApprovalResult {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
  /** Stop the turn rather than let the agent try something else (a plain "no"). */
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

export type { ProviderName };

/**
 * Authentication status for a provider.
 */
export interface AuthStatus {
  /** Whether the provider is installed/available */
  installed: boolean;
  /** Whether the provider is authenticated */
  authenticated: boolean;
  /** Whether auth is enabled (e.g., ANTHROPIC_API_KEY is set) */
  enabled: boolean;
  /** When authentication expires (if applicable) */
  expiresAt?: Date;
  /** User info if available */
  user?: { email?: string; name?: string };
  /**
   * The subscription plan the login belongs to, in the provider's own words
   * ("pro", "max", "plus", "free"…). Absent for API-key logins, which have no plan.
   */
  plan?: string;
}

/**
 * Options for starting a new agent session.
 */
export interface StartSessionOptions {
  /** Working directory for the session */
  cwd: string;
  /** Initial message to send (optional - session can wait for message) */
  initialMessage?: UserMessage;
  /** Session ID to resume (optional) */
  resumeSessionId?: string;
  /**
   * Resume the session from this point of its history, leaving out what came
   * after it: a rewind the provider applies on resume (see `rewindSession`).
   */
  resumeAt?: string;
  /** Permission mode for tool approvals */
  permissionMode?: PermissionMode;
  /** Model to use (e.g., "sonnet", "opus", "haiku") */
  model?: string;
  /** Thinking configuration (undefined = provider default) */
  thinking?: ThinkingConfig;
  /** One of the model's native effort ids (undefined = provider default). */
  effort?: string;
  /** Tool approval callback */
  onToolApproval?: CanUseTool;
}

export interface ForkSessionOptions {
  /** The native session to copy, or to cut. */
  sessionId: string;
  /** Directory the session runs in; Claude Code files its transcripts by it. */
  cwd: string;
  /** User turns to leave out, counted from the end. */
  dropTurns: number;
  /**
   * A rewind not yet applied (see `NativeRewind.resumeAt`): the session's
   * history ends here, whatever the provider's transcript still holds after it.
   */
  resumeAt?: string;
}

/** How the next launch continues a native session that was rewound. */
export interface NativeRewind {
  /** The native session to resume: the same one, unless the provider had to copy it. */
  sessionId: string;
  /** Where to resume it from, when the provider applies the cut on resume. */
  resumeAt?: string;
}

/**
 * Result of starting an agent session.
 * This is the common interface all providers must return.
 */
export interface AgentSession {
  /**
   * The session's events in the provider-neutral model. Provider-native
   * messages never cross this boundary; see providers/events.ts.
   */
  events: AsyncIterableIterator<AgentEvent>;
  /** Message queue for sending messages to the agent */
  queue: MessageQueue;
  /**
   * End the session and its CLI. What it returns settles once the CLI has
   * exited, when the provider can tell; it never rejects.
   */
  abort: () => void | Promise<void>;
  /** Check if the underlying CLI process is still alive (undefined = not available) */
  isProcessAlive?: () => boolean;
  /** Apply a new permission mode to the provider's own side from its next action on. */
  setPermissionMode?: (mode: PermissionMode) => void;
  /** Switch thinking without restarting the session; undefined is the provider default. */
  setThinking?: (thinking: ThinkingConfig | undefined) => Promise<void>;
  /**
   * Interrupt the current turn gracefully without killing the process.
   * The query will stop processing the current turn and return control.
   */
  interrupt?: () => Promise<void>;
}

export type { ProviderCapabilities } from "@scholaraio-hub/shared";

/**
 * A session the provider's own CLI keeps on disk, as the provider's history
 * lists it. Sessions the Hub starts are among them once the CLI has saved them.
 */
export interface NativeSession {
  /** The provider's id: Claude's session id, Codex's thread id. */
  id: string;
  /** The directory the session ran in, as the provider recorded it. */
  cwd: string;
  /** The provider's title: a name the user gave it, a summary, or the first prompt. */
  title: string;
  /** ISO 8601. */
  createdAt: string;
  /** When the session last changed (ISO 8601). */
  updatedAt: string;
  gitBranch?: string;
}

/**
 * One turn of a stored session: what the user sent, then what the agent did,
 * in the provider-neutral event model. A turn without a prompt carries only
 * what the provider recorded before any (a compaction's summary).
 */
export interface NativeTurn {
  /** The provider's id of the prompt: Claude's message uuid, Codex's turn id. */
  id: string;
  /** The prompt as the provider recorded it; empty for a turn without one. */
  prompt: string;
  /** When the prompt was sent (ISO 8601), when the provider says. */
  at?: string;
  events: AgentEvent[];
}

/** Where a provider's CLI writes its session files, so changes to them can be noticed. */
export interface HistoryFiles {
  directory: string;
  /** The session a changed file (relative to `directory`) belongs to; undefined for any other file. */
  sessionOf(file: string): string | undefined;
}

export interface ReadSessionOptions {
  /** Directory the session runs in; Claude Code files its transcripts by it. */
  cwd: string;
  /** A rewind not yet applied (see `NativeRewind.resumeAt`): the history ends here. */
  resumeAt?: string;
}

/**
 * Agent provider interface.
 * All supported providers implement this interface.
 */
export interface AgentProvider {
  /** Provider identifier */
  readonly name: ProviderName;
  /** Human-readable display name */
  readonly displayName: string;
  /** What this provider can do, declared in one place. */
  readonly capabilities: import("@scholaraio-hub/shared").ProviderCapabilities;
  /**
   * How long a turn may go without events before the supervisor suspects the
   * CLI died silently; undefined is the supervisor's default.
   */
  readonly silentTurnLimitMs?: number;

  /**
   * Get detailed authentication status.
   */
  getAuthStatus(): Promise<AuthStatus>;

  /**
   * Start a new agent session.
   * Returns the session iterator, message queue, and abort function.
   */
  startSession(options: StartSessionOptions): Promise<AgentSession>;

  /**
   * Get available models for this provider.
   * For local providers (Codex with Ollama), this queries the local model list.
   * For cloud providers (Claude, Gemini), this returns a static list.
   */
  getAvailableModels(): Promise<ModelInfo[]>;

  /**
   * Slash commands / skills the provider itself offers in `cwd`, in its own
   * terms. Providers without any omit this.
   */
  listCommands?(cwd: string): Promise<SlashCommand[]>;

  /**
   * Copy a native session into a new one without its last `dropTurns` user
   * turns (0 copies all of it), using the provider's own fork. Counting from
   * the end keeps the cut right when the provider compacted older history.
   * Returns the new native session id.
   */
  forkSession?(options: ForkSessionOptions): Promise<string>;

  /**
   * Cut a native session in place so it continues from before its last
   * `dropTurns` user turns, keeping its id and so the provider's prompt cache.
   * Only the conversation goes back; files the agent changed stay as they are.
   * The session must be idle and have no live process.
   */
  rewindSession?(options: ForkSessionOptions): Promise<NativeRewind>;

  /**
   * Get account-level usage limits for providers that expose them.
   */
  getUsageLimits?(): Promise<ProviderUsageLimits>;

  /** Every session the provider's CLI has stored, whoever started it. */
  listSessions(): Promise<NativeSession[]>;

  /** A stored session's conversation, oldest turn first. */
  readSession(id: string, options: ReadSessionOptions): Promise<NativeTurn[]>;

  /** Where the CLI writes its session files; undefined when there is nothing to watch. */
  historyFiles?(): HistoryFiles;
}
