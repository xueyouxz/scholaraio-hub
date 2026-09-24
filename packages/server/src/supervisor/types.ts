import type {
  InputRequest,
  PermissionRules,
  ProviderName,
  ThinkingConfig,
} from "@scholaraio-hub/shared";
import type { AgentEvent } from "../agent/events.js";
import type { PermissionMode } from "../sdk/types.js";

export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export type { InputRequest } from "@scholaraio-hub/shared";

/**
 * Model, provider, and execution settings for a session launch.
 */
export interface ModelSettings {
  /** Model to use (e.g., "sonnet", "opus", "haiku"). undefined = use CLI default */
  model?: string;
  /** Thinking configuration. undefined = thinking disabled */
  thinking?: ThinkingConfig;
  /** Effort level for response quality. undefined = SDK default */
  effort?: string;
  /** Provider to use for this session. undefined = use default provider */
  providerName?: ProviderName;
  /** Global instructions to append to system prompt */
  globalInstructions?: string;
  /** Permission rules for tool filtering */
  permissions?: PermissionRules;
}

// Process state machine
export type ProcessState =
  | { type: "in-turn" }
  | { type: "idle"; since: Date }
  | { type: "waiting-input"; request: InputRequest }
  | { type: "terminated"; reason: string; error?: Error };

// Process events for subscribers
export type ProcessEvent =
  | { type: "agent"; event: AgentEvent }
  | { type: "state-change"; state: ProcessState }
  | { type: "session-id-changed"; oldSessionId: string; newSessionId: string }
  | { type: "error"; error: Error }
  | { type: "complete" }
  | { type: "terminated"; reason: string; error?: Error };

// Process options
export interface ProcessOptions {
  projectPath: string;
  /**
   * The application session this process belongs to. Several sessions can share
   * one project directory, so the path never identifies the owner.
   */
  ownerId?: string;
  sessionId: string;
  idleTimeoutMs?: number; // default 5 minutes
  permissionMode?: PermissionMode;
  provider: ProviderName; // which provider is running this process
  /** Thinking configuration (undefined = thinking disabled) */
  thinking?: ThinkingConfig;
  /** Effort level for response quality (undefined = SDK default) */
  effort?: string;
  /** Permission rules for tool filtering (deny/allow patterns) */
  permissions?: PermissionRules;
}
