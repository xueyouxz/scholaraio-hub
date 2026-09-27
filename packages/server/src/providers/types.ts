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
  /** The native session to copy. */
  sessionId: string;
  /** Directory the session runs in; Claude Code files its transcripts by it. */
  cwd: string;
  /** User turns to leave out, counted from the end. */
  dropTurns: number;
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
   * Get account-level usage limits for providers that expose them.
   */
  getUsageLimits?(): Promise<ProviderUsageLimits>;
}
