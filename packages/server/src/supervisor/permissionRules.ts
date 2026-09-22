/**
 * Per-session allow/deny rules, e.g. `Bash(curl *)`.
 *
 * These are evaluated before the mode-level contract in
 * `sdk/providers/permission-policy.ts`: an explicit rule the user wrote for
 * this session outranks what the mode would otherwise do. Deny wins over allow.
 */

import type { PermissionRules } from "@scholaraio-hub/shared";
import { getLogger } from "../logging/logger.js";
import type { ToolApprovalResult } from "../sdk/types.js";

/** Convert a glob (only `*` is special) to an anchored RegExp. */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

/** Does `ToolName(glob)` match this invocation? */
export function matchesPermissionPattern(
  pattern: string,
  toolName: string,
  input: unknown,
): boolean {
  const match = pattern.match(/^(\w+)\((.+)\)$/);
  if (!match) return false;
  const [, patternTool, glob] = match;
  if (!patternTool || !glob || patternTool !== toolName) return false;

  // Bash matches on the command; everything else on its serialized input.
  const subject =
    toolName === "Bash"
      ? ((input as { command?: string } | null)?.command ?? "")
      : typeof input === "string"
        ? input
        : JSON.stringify(input);

  return globToRegex(glob).test(subject);
}

/**
 * Apply a session's rules to one tool call.
 * Returns undefined when no rule matches, so the caller falls through to the
 * permission mode.
 */
export function matchPermissionRules(
  rules: PermissionRules | undefined,
  toolName: string,
  input: unknown,
): ToolApprovalResult | undefined {
  if (!rules) return undefined;

  for (const pattern of rules.deny ?? []) {
    if (matchesPermissionPattern(pattern, toolName, input)) {
      const command = toolName === "Bash" ? ((input as { command?: string })?.command ?? "") : "";
      getLogger().warn(
        `[permissions] Denied ${toolName}: "${command}" matched deny pattern "${pattern}"`,
      );
      return { behavior: "deny", message: `Blocked by permission rule: ${pattern}` };
    }
  }

  for (const pattern of rules.allow ?? []) {
    if (matchesPermissionPattern(pattern, toolName, input)) {
      return { behavior: "allow" };
    }
  }

  return undefined;
}
