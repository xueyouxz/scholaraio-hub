export interface SubagentRoute {
  /** Key used for agentContent. Prefer the real agentId when the provider sends it. */
  agentId: string;
  /** Parent Task/Agent tool_use id, when available. */
  toolUseId?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolve subagent routing metadata from normalized SSE/JSONL-like messages.
 *
 * Legacy SDK messages carry parent_tool_use_id/parentToolUseId. Newer SDK
 * sidechain messages carry agentId + isSubagent but no parent tool id. When
 * both are present, store content under the real agentId and register the
 * parent tool id as a lookup alias for TaskRenderer.
 */
export function getSubagentRoute(message: Record<string, unknown>): SubagentRoute | null {
  if (message.isSubagent !== true) {
    return null;
  }

  const toolUseId = asString(message.parentToolUseId) ?? asString(message.parent_tool_use_id);
  const agentId = asString(message.agentId) ?? toolUseId;

  if (!agentId) {
    return null;
  }

  return {
    agentId,
    ...(toolUseId ? { toolUseId } : {}),
  };
}
