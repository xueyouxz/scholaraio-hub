/**
 * The agent providers, in the order they are offered:
 * - "claude": Claude Code via the Anthropic Agent SDK
 * - "codex": OpenAI Codex via the codex app-server
 *
 * Every name here must have an implementation in
 * `packages/server/src/providers/index.ts`.
 */
export const PROVIDER_NAMES = ["claude", "codex"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
/** The provider a request or setting uses when it names none. */
export const DEFAULT_PROVIDER: ProviderName = "claude";

export function isProviderName(value: unknown): value is ProviderName {
  return PROVIDER_NAMES.some((name) => name === value);
}

/**
 * Model information for a provider.
 */
export interface ModelInfo {
  /** Model identifier (e.g., "sonnet", "qwen2.5-coder:0.5b") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the model's capabilities (optional) */
  description?: string;
  /** The provider's own default model. */
  isDefault?: boolean;
  /** Effort levels the provider offers for this model, in its order and naming. */
  efforts?: EffortOption[];
  /** The effort the provider uses when none is chosen. */
  defaultEffort?: string;
}

/** One effort level as the provider names and describes it. */
export interface EffortOption {
  id: string;
  description?: string;
}

/**
 * Slash command (skill) available in a session.
 */
export interface SlashCommand {
  /** Command name without leading slash (e.g., "commit", "review-pr") */
  name: string;
  /** Description of what the command does */
  description: string;
  /** Hint for command arguments (e.g., "<file>") */
  argumentHint?: string;
  /** Where the command comes from: the provider, the hub's research skills, or the composer itself. */
  source?: "provider" | "project" | "global" | "research" | "client";
  /**
   * How the composer invokes it: `/name` for commands, `$name` for Codex skill
   * mentions. Defaults to "/".
   */
  trigger?: "/" | "$";
  /** Only at the very start of the message (default), or at any word. */
  position?: "leading" | "anywhere";
}

/**
 * A scholaraio research skill discovered under SCHOLARAIO_SKILLS_DIR.
 */
export interface ScholaraioSkill {
  name: string;
  description: string;
  /** Manifest category id; "__uncategorized__" if not in manifest. */
  category: string;
  source: "research";
  /**
   * The papers it works on, passed as their ids: exactly one, two or more, or
   * any number. Absent for a skill that takes no papers.
   */
  papers?: "single" | "multi" | "any";
}

export interface ScholaraioSkillDetail extends ScholaraioSkill {
  /** Raw SKILL.md body (without frontmatter). */
  body: string;
  /** Absolute filesystem path to SKILL.md (developer use). */
  path: string;
}

export interface ScholaraioSkillCategory {
  id: string;
  label: string;
  order: number;
}

export interface ScholaraioSkillsResponse {
  categories: ScholaraioSkillCategory[];
  skills: ScholaraioSkill[];
}

/**
 * Provider info for UI display.
 */
export interface ProviderInfo {
  name: ProviderName;
  displayName: string;
  installed: boolean;
  authenticated: boolean;
  enabled: boolean;
  expiresAt?: string;
  user?: { email?: string; name?: string };
  /** Subscription plan of the login ("pro", "plus"…); absent for API-key logins. */
  plan?: string;
  /** Available models for this provider */
  models?: ModelInfo[];
  /** Why the models could not be listed; the login fields still hold. */
  modelsError?: string;
  /** What the composer offers for this provider, in the provider's own terms. */
  capabilities: ProviderCapabilities;
  /** Why the provider's status could not be read; the other fields then say nothing. */
  error?: string;
}

/** One permission choice as the provider names it, and the hub mode it maps to. */
export interface PermissionModeOption {
  id: PermissionMode;
  label: string;
  description?: string;
}

/** One thinking choice as the provider names it. */
export interface ThinkingModeOption {
  id: ThinkingMode;
  label: string;
}

/** Hub-wide limits on files attached to one message. */
export const ATTACHMENT_LIMITS = { maxBytes: 25 * 1024 * 1024, maxCount: 10 } as const;

/**
 * What a provider offers, as one descriptor instead of `supportsX` booleans.
 * Choices carry the provider's own names; the UI renders them and hard-codes none.
 */
export interface ProviderCapabilities {
  /** Permission choices in the provider's order; empty when it has none. */
  permissionModes: PermissionModeOption[];
  /** Thinking switch choices; empty when the provider only has effort levels. */
  thinkingModes: ThinkingModeOption[];
  /**
   * Where the provider honours a slash command: only at the start of the
   * message, or at any word (skills referenced mid-sentence).
   */
  slashCommands: "leading" | "anywhere";
  /** Whether the provider reports context as the share used or the share left. */
  contextUsage: "used" | "remaining";
  attachments: { maxBytes: number; maxCount: number };
}

export type ProviderUsageLimitWindowName =
  | "fiveHour"
  | "weekly"
  | "weeklyOpus"
  | "weeklySonnet"
  | "overage"
  | "unknown";

export type ProviderUsageLimitSource =
  | "claude-sdk-rate-limit-event"
  | "claude-oauth-usage-api"
  | "codex-app-server"
  | "codex-jsonl"
  | "unavailable";

export interface ProviderUsageLimitWindow {
  name: ProviderUsageLimitWindowName;
  label: string;
  usedPercent?: number;
  resetsAt?: string;
  resetsAtEpochSeconds?: number;
  windowMinutes?: number;
  status?: "allowed" | "allowed_warning" | "rejected" | "unknown";
  source: ProviderUsageLimitSource;
}

export interface ProviderUsageLimits {
  provider: ProviderName;
  available: boolean;
  updatedAt?: string;
  windows: ProviderUsageLimitWindow[];
  error?: string;
}

/**
 * Permission mode for tool approvals.
 * - "default": Auto-approve read-only tools (Read, Glob, Grep, etc.), ask for mutating tools
 * - "acceptEdits": Auto-approve file editing tools (Edit, Write, NotebookEdit), ask for others
 * - "plan": Auto-approve read-only tools, ask for others (planning/analysis mode)
 * - "bypassPermissions": Auto-approve all tools (full autonomous mode)
 */
export type PermissionMode = "default" | "bypassPermissions" | "acceptEdits" | "plan";

/**
 * All permission modes in canonical order.
 * Used for validation, dropdowns, and iteration.
 * Keep in sync with PermissionMode above.
 */
export const ALL_PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

/**
 * Saved defaults for the new session form.
 */
export interface NewSessionDefaults {
  provider?: ProviderName;
  model?: string;
  permissionMode?: PermissionMode;
}

/** Whether the model thinks before answering, for providers that offer the switch. */
export type ThinkingMode = "off" | "adaptive";

/**
 * A session's execution options in the provider's own terms: `effort` is one of
 * the model's `efforts` ids (Claude "low".."max", Codex "none".."xhigh").
 */
export interface ExecutionOptions {
  thinking?: ThinkingMode;
  effort?: string;
}

/**
 * Thinking configuration for the SDK.
 */
export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens?: number }
  | { type: "disabled" };

export function thinkingModeToConfig(mode: ThinkingMode): ThinkingConfig {
  return mode === "off" ? { type: "disabled" } : { type: "adaptive" };
}

/**
 * Sessions stored before thinking and effort were separate kept one combined
 * value: "off" | "auto" | "on:<effort>" | "<effort>".
 */
export function readLegacyThinking(value: string): ExecutionOptions {
  if (value === "off" || value === "adaptive") return { thinking: value };
  if (value === "auto") return { thinking: "adaptive" };
  const effort = value.startsWith("on:") ? value.slice(3) : value;
  return effort ? { thinking: "adaptive", effort } : {};
}

/**
 * An entry in a project filesystem browse response.
 */
export interface SessionFsEntry {
  name: string;
  isDir: boolean;
  /** True for files/dirs whose name starts with "." */
  isDotfile: boolean;
}

/**
 * Response from GET /api/sessions/:id/fs/browse
 */
export interface SessionDirectoryListing {
  /** Relative path from project root that was listed */
  path: string;
  entries: SessionFsEntry[];
}
