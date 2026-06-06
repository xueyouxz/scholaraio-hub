import type { SlashCommand, StreamMessagePayload } from "@scholaraio-hub/shared";
import type { Dispatch, SetStateAction } from "react";
import type { PendingMessage } from "../hooks/useSession";
import type { Message } from "../types";
import { getSubagentRoute } from "./subagentRouting";

/**
 * Dependencies the SDK-message sub-dispatch needs from the owning hook. Kept as
 * an explicit context object so the dispatch logic lives outside the 1000-line
 * hook and every wiring point is checked by the compiler.
 */
export interface SdkStreamMessageContext {
  /** Returns true when the streaming subsystem fully consumed the delta. */
  handleStreamEvent: (data: Record<string, unknown>) => boolean;
  clearStreaming: () => void;
  clearStreamingPlaceholders: (agentId?: string) => void;
  registerToolUseAgent: (toolUseId: string, agentId: string) => void;
  handleStreamSubagentMessage: (incoming: Message, agentId: string) => void;
  handleStreamMessageEvent: (incoming: Message) => void;
  setSlashCommands: Dispatch<SetStateAction<SlashCommand[]>>;
  setIsCompacting: (value: boolean) => void;
  removePendingMessage: (tempId: string) => void;
  setPendingMessages: Dispatch<SetStateAction<PendingMessage[]>>;
}

/** Extract plain text from a user SDK message for tempId-less pending matching. */
function extractUserMessageText(sdkMessage: Record<string, unknown>): string | null {
  const message = sdkMessage.message as { content?: unknown; role?: unknown } | undefined;
  const content = message?.content;

  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .filter((part) => part.length > 0);
    if (textParts.length === 0) return null;
    const joined = textParts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }

  return null;
}

/**
 * Second-level dispatch for `message` stream events: the SSE skeleton carries
 * raw SDK messages, and this routes them by `type`/`subtype`:
 *  - `stream_event`  → streaming subsystem (delta accumulation), may short-circuit
 *  - `assistant`     → final turn message; clears streaming placeholders
 *  - `system:init`   → captures available skills as slash commands
 *  - `system:status` → compaction indicator (transient, not appended)
 *  - `system:compact_boundary` → clears the indicator, message still appended
 *  - `user`          → reconciles the optimistic pending queue (tempId or text)
 *  - subagent routes → diverted to agentContent instead of the main message list
 */
export function handleSdkStreamMessage(
  sdkMessage: StreamMessagePayload,
  ctx: SdkStreamMessageContext,
): void {
  // ID fallback chain: uuid (final) → id (intermediate) → locally generated.
  const rawUuid = sdkMessage.uuid;
  const rawId = sdkMessage.id;
  const id: string =
    (typeof rawUuid === "string" ? rawUuid : null) ??
    (typeof rawId === "string" ? rawId : null) ??
    `msg-${Date.now()}`;

  const msgType = typeof sdkMessage.type === "string" ? sdkMessage.type : undefined;
  const msgRole = sdkMessage.role as Message["role"] | undefined;

  // Anthropic streaming deltas — delegate to the streaming subsystem.
  if (msgType === "stream_event") {
    if (ctx.handleStreamEvent(sdkMessage)) {
      return; // consumed by streaming; skip the merge path
    }
  }

  // Final assistant message: all _isStreaming placeholders must be replaced.
  if (msgType === "assistant") {
    const subagentRoute = getSubagentRoute(sdkMessage);
    ctx.clearStreaming();
    if (subagentRoute) {
      ctx.clearStreamingPlaceholders(subagentRoute.agentId);
    } else {
      ctx.clearStreamingPlaceholders();
    }
  }

  // Build the internal Message, preserving all SDK fields.
  const incoming: Message = {
    ...(sdkMessage as Partial<Message>),
    id,
    type: msgType,
    role: msgRole ?? (msgType === "user" || msgType === "assistant" ? msgType : undefined),
  };

  // init carries this session's available skills (we intentionally ignore the
  // CLI's own slash_commands, which can't run in the web client).
  if (msgType === "system" && sdkMessage.subtype === "init") {
    if (Array.isArray(sdkMessage.skills)) {
      ctx.setSlashCommands((prev) => {
        const descriptions = new Map(prev.map((command) => [command.name, command]));
        return (sdkMessage.skills as string[]).map((name) => ({
          ...descriptions.get(name),
          name,
          description: descriptions.get(name)?.description ?? "",
        }));
      });
    }
  }

  // Transient compaction indicator — not appended to the message list.
  if (msgType === "system" && sdkMessage.subtype === "status") {
    const status = sdkMessage.status as "compacting" | null;
    ctx.setIsCompacting(status === "compacting");
    return;
  }

  // Boundary marker: clear the indicator but keep the message (renders divider).
  if (msgType === "system" && sdkMessage.subtype === "compact_boundary") {
    ctx.setIsCompacting(false);
  }

  // Reconcile the optimistic pending queue against the echoed user message.
  const tempId = sdkMessage.tempId as string | undefined;
  if (msgType === "user" && tempId) {
    ctx.removePendingMessage(tempId);
  } else if (msgType === "user") {
    // Providers like Codex don't echo tempId; fall back to a single text match.
    const incomingText = extractUserMessageText(sdkMessage);
    if (incomingText) {
      ctx.setPendingMessages((prev) => {
        const idx = prev.findIndex((p) => p.content.trim() === incomingText);
        if (idx === -1) return prev;
        return prev.filter((_, i) => i !== idx);
      });
    }
  }

  // Subagent routing: divert to agentContent[agentId] so the main DAG stays clean.
  const subagentRoute = getSubagentRoute(sdkMessage);
  if (subagentRoute) {
    if (subagentRoute.toolUseId) {
      ctx.registerToolUseAgent(subagentRoute.toolUseId, subagentRoute.agentId);
    }
    ctx.handleStreamSubagentMessage(incoming, subagentRoute.agentId);
    return;
  }

  // Main stream: hand to useSessionMessages for buffering + merge/dedupe.
  ctx.handleStreamMessageEvent(incoming);
}
