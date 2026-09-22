// Provider abstraction types for multi-provider support
import type {
  ModelInfo,
  PermissionMode,
  ProviderName,
  ProviderUsageLimits,
  SlashCommand,
} from "@scholaraio-hub/shared";
import type { AgentEvent } from "../../agent/events.js";
import type { MessageQueue } from "../messageQueue.js";
import type { CanUseTool, UserMessage } from "../types.js";

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
  /** Thinking configuration (undefined = thinking disabled) */
  thinking?: import("@scholaraio-hub/shared").ThinkingConfig;
  /** One of the model's native effort ids (undefined = provider default). */
  effort?: string;
  /** Tool approval callback */
  onToolApproval?: CanUseTool;
  /** Global instructions to append to system prompt (from server settings) */
  globalInstructions?: string;
  /** Optional remote executor identifier */
  executor?: string;
  /** Optional environment overrides for remote execution */
  remoteEnv?: Record<string, string>;
}

/**
 * Result of starting an agent session.
 * This is the common interface all providers must return.
 */
export interface AgentSession {
  /**
   * The session's events in the provider-neutral model. Provider-native
   * messages never cross this boundary; see src/agent/events.ts.
   */
  events: AsyncIterableIterator<AgentEvent>;
  /** Message queue for sending messages to the agent */
  queue: MessageQueue;
  /** Abort function to cancel the session */
  abort: () => void;
  /** Check if the underlying CLI process is still alive (undefined = not available) */
  isProcessAlive?: () => boolean;
  /** OS PID of the spawned agent child process (undefined if not available) */
  pid?: number | (() => number | undefined);
  /** Session ID if available immediately (some providers provide later via messages) */
  sessionId?: string;
  /**
   * Steer an active turn with additional user input.
   * Returns true when steered immediately, false when caller should enqueue instead.
   */
  steer?: (message: UserMessage) => Promise<boolean>;
  /**
   * Change max thinking tokens without restarting the session.
   * Pass null to disable thinking mode.
   * Only supported by Claude SDK 0.2.7+.
   */
  setMaxThinkingTokens?: (tokens: number | null) => Promise<void>;
  /**
   * Interrupt the current turn gracefully without killing the process.
   * The query will stop processing the current turn and return control.
   * Only supported by Claude SDK 0.2.7+.
   */
  interrupt?: () => Promise<void>;
  /**
   * Get the list of available models from the SDK.
   * Only supported by Claude SDK 0.2.7+.
   */
  supportedModels?: () => Promise<ModelInfo[]>;
  /**
   * Get the list of available slash commands (skills) from the SDK.
   * Only supported by Claude SDK 0.2.7+.
   */
  supportedCommands?: () => Promise<SlashCommand[]>;
  /**
   * Change the model mid-session without restarting.
   * Only supported by Claude SDK 0.2.7+.
   */
  setModel?: (model?: string) => Promise<void>;
}

/**
 * What a provider supports, as a single descriptor rather than a growing list
 * of `supportsX` booleans spread across the interface, the HTTP payload and
 * the UI. Add a capability here and every consumer has to acknowledge it.
 */
export interface ProviderCapabilities {
  /** Permission modes (default / acceptEdits / plan / bypass) are meaningful. */
  permissionMode: boolean;
  /** Extended thinking can be toggled per session. */
  thinkingToggle: boolean;
  /** Slash commands can be listed and invoked. */
  slashCommands: boolean;
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
  readonly capabilities: ProviderCapabilities;

  /**
   * Check if this provider is installed and available.
   * For SDK-based providers, this is always true.
   * For CLI-based providers, this checks if the binary exists.
   */
  isInstalled(): Promise<boolean>;

  /**
   * Check if this provider is authenticated.
   * Returns true if the provider can be used immediately.
   */
  isAuthenticated(): Promise<boolean>;

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
   * Get account-level usage limits for providers that expose them.
   */
  getUsageLimits?(): Promise<ProviderUsageLimits>;
}
