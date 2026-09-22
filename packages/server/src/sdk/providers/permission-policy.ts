/**
 * The permission contract shared by every provider.
 *
 * A PermissionMode is a promise to the user about what runs without asking. It
 * has two halves, and both must hold for every provider:
 *
 * 1. **Who decides** — the hub decides. Providers route every tool the mode
 *    does not auto-approve back to us through `onToolApproval`; they must not
 *    silently widen a mode by answering on their own. `providerPosture()` is
 *    the only sanctioned place to translate a mode into provider-native
 *    approval settings.
 * 2. **What the sandbox allows** — the filesystem/network boundary the provider
 *    enforces underneath our decisions, for providers that have one.
 *
 * Keeping both halves here is what stops the two providers from drifting: Claude
 * used to implement bypassPermissions in our callback while Codex implemented it
 * by handing the sandbox full access and never calling us, so the same UI toggle
 * meant two different things.
 */

import type { PermissionMode } from "@scholaraio-hub/shared";

/**
 * Tools that are inherently a question to the user. No mode auto-answers them,
 * including bypassPermissions — answering them for the user would be answering
 * on their behalf, not skipping a confirmation.
 */
export const ALWAYS_INTERACTIVE_TOOLS = ["ExitPlanMode", "AskUserQuestion"] as const;

/** Tools that only read state. Auto-approved in every mode. */
export const READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LSP",
  "WebFetch",
  "WebSearch",
  "Task", // Subagent exploration (legacy)
  "Agent", // Subagent exploration (SDK 0.2.76+)
  "TaskOutput", // Reading subagent results
] as const;

/** Tools that modify files. Auto-approved from acceptEdits upwards. */
export const EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** Plan mode still lets the agent save its plan without a prompt. */
const PLAN_WRITABLE_PATH = ".claude/plans/";

export type PermissionDecision = "allow" | "ask";

/**
 * Decide what a mode does with one tool call, before any per-session allow/deny
 * rules are applied. Pure: the caller owns prompting and bookkeeping.
 */
export function decidePermission(
  mode: PermissionMode,
  toolName: string,
  input: unknown,
): PermissionDecision {
  if ((ALWAYS_INTERACTIVE_TOOLS as readonly string[]).includes(toolName)) return "ask";
  if ((READ_ONLY_TOOLS as readonly string[]).includes(toolName)) return "allow";

  switch (mode) {
    case "bypassPermissions":
      return "allow";
    case "acceptEdits":
      return (EDIT_TOOLS as readonly string[]).includes(toolName) ? "allow" : "ask";
    case "plan": {
      if (toolName !== "Write") return "ask";
      const filePath = (input as { file_path?: string } | null)?.file_path ?? "";
      return filePath.includes(PLAN_WRITABLE_PATH) ? "allow" : "ask";
    }
    default:
      return "ask";
  }
}

/** The sandbox boundary a provider enforces underneath our decisions. */
export type SandboxBoundary = "read-only" | "workspace-write" | "full-access";

export interface PermissionPosture {
  sandbox: SandboxBoundary;
  /**
   * Whether the provider must keep asking us about tool calls. Always true:
   * a provider that stops asking has taken the decision away from the user.
   * The field exists so the intent is visible at each provider's mapping.
   */
  askHub: true;
}

export function providerPosture(mode: PermissionMode | undefined): PermissionPosture {
  switch (mode) {
    case "plan":
      return { sandbox: "read-only", askHub: true };
    case "bypassPermissions":
      return { sandbox: "full-access", askHub: true };
    default:
      return { sandbox: "workspace-write", askHub: true };
  }
}
