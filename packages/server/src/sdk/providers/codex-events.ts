/**
 * Codex app-server event conversion.
 *
 * Turns app-server JSON-RPC notifications into AgentEvent, the provider-neutral
 * model in `src/agent/events.ts`. Kept apart from the provider so the mapping
 * can be tested on its own (see test/sdk/codex-conversion.golden.test.ts) and so
 * transport concerns never leak into it.
 *
 * Codex vocabulary (thread items, turn ids, snake/camel status strings) stops
 * here. Tool invocations are canonicalized to the shared tool vocabulary
 * (Read / Edit / Bash / WebSearch …) via `codex/normalization.ts`.
 */

import type { AgentEvent, TokenUsage } from "../../agent/events.js";
import { TurnState } from "../../agent/turnState.js";
import {
  isCodexCorrelationDebugEnabled,
  logCodexCorrelationDebug,
} from "../../codex/correlationDebugLogger.js";
import {
  type CodexToolCallContext,
  normalizeCodexCommandExecutionOutput,
  normalizeCodexToolInvocation,
} from "../../codex/normalization.js";
import type { UserMessage } from "../types.js";
import type {
  ErrorNotification as CodexErrorNotification,
  ItemCompletedNotification as CodexItemCompletedNotification,
  ItemStartedNotification as CodexItemStartedNotification,
  ThreadItem as CodexThreadItem,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  ThreadTokenUsageUpdatedNotification,
  ToolRequestUserInputParams,
  TurnCompletedNotification,
} from "./codex-protocol/index.js";
import type { JsonRpcNotification } from "./codex-rpc.js";

export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface NormalizedFileChange {
  path: string;
  kind: "add" | "delete" | "update";
  diff?: string;
}

export type NormalizedThreadItem =
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "agent_message"; text: string }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregated_output: string;
      exit_code?: number;
      status: string;
    }
  | {
      id: string;
      type: "file_change";
      changes: NormalizedFileChange[];
      status: string;
    }
  | {
      id: string;
      type: "mcp_tool_call";
      server: string;
      tool: string;
      arguments: unknown;
      result?: unknown;
      error?: { message: string };
      status: string;
    }
  | { id: string; type: "web_search"; query: string }
  | {
      id: string;
      type: "todo_list";
      items: Array<{ text: string; completed: boolean }>;
    }
  | { id: string; type: "error"; message: string }
  | { id: string; type: "image_view"; path: string };

export function isTurnTerminalNotification(
  notification: JsonRpcNotification,
  turnId: string,
): boolean {
  if (notification.method === "turn/completed") {
    const params = asTurnCompletedNotification(notification.params);
    return params?.turn.id === turnId;
  }

  if (notification.method === "error") {
    const params = asErrorNotification(notification.params);
    return params?.turnId === turnId && !params.willRetry;
  }

  return false;
}

export function extractTurnUsage(params: unknown): {
  turnId: string;
  snapshot: TokenUsageSnapshot;
} | null {
  const notification = asThreadTokenUsageUpdatedNotification(params);
  if (!notification) return null;

  return {
    turnId: notification.turnId,
    snapshot: {
      inputTokens: notification.tokenUsage.last.inputTokens,
      outputTokens: notification.tokenUsage.last.outputTokens,
      cachedInputTokens: notification.tokenUsage.last.cachedInputTokens,
    },
  };
}

export function normalizeThreadItem(
  item: CodexThreadItem | Record<string, unknown>,
): NormalizedThreadItem | null {
  const itemRecord = item as Record<string, unknown>;
  const id = getOptionalString(itemRecord.id);
  const type = getOptionalString(itemRecord.type);
  if (!id || !type) {
    return null;
  }

  const normalizedType = type.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

  switch (normalizedType) {
    case "reasoning": {
      const text = getReasoningText(itemRecord);
      if (!text) return null;
      return { id, type: "reasoning", text };
    }

    case "agent_message":
    case "plan": {
      const text = getOptionalString(itemRecord.text) ?? "";
      return { id, type: "agent_message", text };
    }

    case "command_execution": {
      return {
        id,
        type: "command_execution",
        command: getOptionalString(itemRecord.command) ?? "",
        aggregated_output:
          getOptionalString(itemRecord.aggregated_output) ??
          getOptionalString(itemRecord.aggregatedOutput) ??
          "",
        exit_code:
          getOptionalNumber(itemRecord.exit_code) ??
          getOptionalNumber(itemRecord.exitCode) ??
          undefined,
        status: normalizeStatus(itemRecord.status),
      };
    }

    case "file_change": {
      const changesRaw = Array.isArray(itemRecord.changes) ? itemRecord.changes : [];
      const changes: NormalizedFileChange[] = [];
      for (const change of changesRaw) {
        if (!change || typeof change !== "object") continue;
        const record = change as Record<string, unknown>;
        const path = getOptionalString(record.path);
        if (!path) continue;

        let kind: "add" | "delete" | "update" = "update";
        const rawKind = record.kind;
        if (typeof rawKind === "string") {
          if (rawKind === "add" || rawKind === "delete" || rawKind === "update") {
            kind = rawKind;
          }
        } else if (rawKind && typeof rawKind === "object") {
          const rawType = getOptionalString((rawKind as Record<string, unknown>).type);
          if (rawType === "add" || rawType === "delete" || rawType === "update") {
            kind = rawType;
          }
        }

        const diff = getOptionalString(record.diff) ?? undefined;
        changes.push({
          path,
          kind,
          ...(diff ? { diff } : {}),
        });
      }

      return {
        id,
        type: "file_change",
        changes,
        status: normalizeStatus(itemRecord.status),
      };
    }

    case "mcp_tool_call": {
      const errorObj =
        itemRecord.error && typeof itemRecord.error === "object"
          ? (itemRecord.error as Record<string, unknown>)
          : null;

      return {
        id,
        type: "mcp_tool_call",
        server: getOptionalString(itemRecord.server) ?? "unknown",
        tool: getOptionalString(itemRecord.tool) ?? "unknown",
        arguments: itemRecord.arguments,
        result: itemRecord.result,
        error:
          getOptionalString(errorObj?.message) !== null
            ? { message: getOptionalString(errorObj?.message) ?? "" }
            : undefined,
        status: normalizeStatus(itemRecord.status),
      };
    }

    case "web_search": {
      return {
        id,
        type: "web_search",
        query: getOptionalString(itemRecord.query) ?? "",
      };
    }

    case "todo_list": {
      const items = Array.isArray(itemRecord.items)
        ? itemRecord.items
            .map((entry: unknown) => {
              if (!entry || typeof entry !== "object") return null;
              const record = entry as Record<string, unknown>;
              const text = getOptionalString(record.text);
              if (!text) return null;
              return {
                text,
                completed: record.completed === true,
              };
            })
            .filter(
              (entry: unknown): entry is { text: string; completed: boolean } => entry !== null,
            )
        : [];
      return {
        id,
        type: "todo_list",
        items,
      };
    }

    case "image_view": {
      const imagePath = getOptionalString(itemRecord.path) ?? "";
      if (!imagePath) return null;
      return { id, type: "image_view", path: imagePath };
    }

    case "error": {
      const message = getOptionalString(itemRecord.message) ?? "Codex error";
      return {
        id,
        type: "error",
        message,
      };
    }

    default:
      return null;
  }
}

export function getReasoningText(item: Record<string, unknown>): string {
  const text = getOptionalString(item.text);
  if (text) return text;

  const content = Array.isArray(item.content)
    ? item.content.filter((part): part is string => typeof part === "string")
    : [];
  if (content.length > 0) {
    return content.join("\n");
  }

  const summary = Array.isArray(item.summary)
    ? item.summary.filter((part): part is string => typeof part === "string")
    : [];
  if (summary.length > 0) {
    return summary.join("\n");
  }

  return "";
}

export function normalizeStatus(status: unknown): string {
  if (typeof status !== "string") return "unknown";
  return status.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

export function asTurnCompletedNotification(params: unknown): TurnCompletedNotification | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    !record.turn ||
    typeof record.turn !== "object" ||
    typeof (record.turn as { id?: unknown }).id !== "string"
  ) {
    return null;
  }
  return params as TurnCompletedNotification;
}

export function asErrorNotification(params: unknown): CodexErrorNotification | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.willRetry !== "boolean" ||
    !record.error ||
    typeof record.error !== "object" ||
    typeof (record.error as { message?: unknown }).message !== "string"
  ) {
    return null;
  }
  return params as CodexErrorNotification;
}

export function asThreadTokenUsageUpdatedNotification(
  params: unknown,
): ThreadTokenUsageUpdatedNotification | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const tokenUsage =
    record.tokenUsage && typeof record.tokenUsage === "object"
      ? (record.tokenUsage as Record<string, unknown>)
      : null;
  const last =
    tokenUsage?.last && typeof tokenUsage.last === "object"
      ? (tokenUsage.last as Record<string, unknown>)
      : null;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    !last ||
    typeof last.inputTokens !== "number" ||
    typeof last.outputTokens !== "number" ||
    typeof last.cachedInputTokens !== "number"
  ) {
    return null;
  }
  return params as ThreadTokenUsageUpdatedNotification;
}

export function asCommandExecutionRequestApprovalParams(
  params: unknown,
): CommandExecutionRequestApprovalParams | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.itemId !== "string"
  ) {
    return null;
  }
  return params as CommandExecutionRequestApprovalParams;
}

export function asFileChangeRequestApprovalParams(
  params: unknown,
): FileChangeRequestApprovalParams | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.itemId !== "string"
  ) {
    return null;
  }
  return params as FileChangeRequestApprovalParams;
}

export function asToolRequestUserInputParams(params: unknown): ToolRequestUserInputParams | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.itemId !== "string" ||
    !Array.isArray(record.questions)
  ) {
    return null;
  }
  return params as ToolRequestUserInputParams;
}

export function asItemStartedNotification(params: unknown): CodexItemStartedNotification | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    !record.item ||
    typeof record.item !== "object"
  ) {
    return null;
  }
  return params as CodexItemStartedNotification;
}

export function asItemCompletedNotification(
  params: unknown,
): CodexItemCompletedNotification | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    !record.item ||
    typeof record.item !== "object"
  ) {
    return null;
  }
  return params as CodexItemCompletedNotification;
}

/** Plain text of a queued user message, as sent to `turn/start`. */
export function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  // Handle UserMessage format
  const userMsg = message as UserMessage;
  if (typeof userMsg.text === "string") {
    return userMsg.text;
  }

  // Handle SDK message format
  const sdkMsg = message as {
    message?: { content?: string | unknown[] };
  };
  const content = sdkMsg.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block: unknown) => {
        if (typeof block === "string") return block;
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          (block as { type: string }).type === "text" &&
          "text" in block
        ) {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export function getOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function getOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type ItemPhase = "item/started" | "item/completed";

/** Stable id for anything scoped to one item of one turn. */
function itemKey(itemId: string, turnId: string): string {
  return `${itemId}-${turnId}`;
}

function fileChangeSummary(item: Extract<NormalizedThreadItem, { type: "file_change" }>): string {
  const summary = item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n");
  if (item.status === "completed") return `File changes applied:\n${summary}`;
  if (item.status === "declined") return `File changes declined:\n${summary}`;
  return `File changes failed:\n${summary}`;
}

/**
 * Stateful: one adapter per app-server thread. Tracks the open turn so exactly
 * one `turn.completed` is produced per turn, whichever of `turn/completed`, an
 * `error` notification or a failed `turn/start` ends it.
 */
export class CodexEventAdapter {
  private turn = new TurnState();
  private usageByTurnId = new Map<string, TokenUsageSnapshot>();
  private activeTurnId: string | null = null;

  constructor(private sessionId = "") {}

  /** The thread is ready; announce its id. */
  started(sessionId: string): AgentEvent[] {
    this.sessionId = sessionId;
    return [{ type: "session.started", sessionId }];
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
  }

  get turnOpen(): boolean {
    return this.activeTurnId !== null;
  }

  /** End the open turn (if any). The first caller wins; later calls are no-ops. */
  completeTurn(error?: string): AgentEvent[] {
    if (this.activeTurnId === null) return [];
    const turnId = this.activeTurnId;
    const snapshot = this.usageByTurnId.get(turnId);
    const usage: TokenUsage | undefined = snapshot
      ? {
          inputTokens: snapshot.inputTokens,
          outputTokens: snapshot.outputTokens,
          cachedInputTokens: snapshot.cachedInputTokens,
        }
      : undefined;
    this.activeTurnId = null;
    this.usageByTurnId.delete(turnId);
    this.turn = new TurnState();
    return [{ type: "turn.completed", ...(error ? { error } : {}), ...(usage ? { usage } : {}) }];
  }

  /**
   * The session broke outside a turn's normal ending (transport failure,
   * spawn failure). Report it as a failed turn so the run still finishes.
   */
  fail(error: string): AgentEvent[] {
    if (this.activeTurnId !== null) return this.completeTurn(error);
    return [{ type: "turn.completed", error }];
  }

  notification(notification: JsonRpcNotification): AgentEvent[] {
    const events = this.convert(notification);
    if (isCodexCorrelationDebugEnabled()) {
      for (const event of events) {
        logCodexCorrelationDebug({
          sessionId: this.sessionId,
          channel: "sdk",
          authority: "transient",
          eventKind: event.type,
          turnId: this.activeTurnId ?? undefined,
          sourceEvent: notification.method,
          ...("callId" in event ? { callId: event.callId } : {}),
        });
      }
    }
    return events;
  }

  private convert(notification: JsonRpcNotification): AgentEvent[] {
    switch (notification.method) {
      case "item/agentMessage/delta": {
        const params = notification.params as Record<string, unknown> | undefined;
        if (
          params?.threadId !== this.sessionId ||
          typeof params?.itemId !== "string" ||
          typeof params?.turnId !== "string" ||
          typeof params?.delta !== "string"
        ) {
          return [];
        }
        return this.turn.textDelta("text", itemKey(params.itemId, params.turnId), params.delta);
      }

      case "thread/tokenUsage/updated": {
        const usage = extractTurnUsage(notification.params);
        if (usage) this.usageByTurnId.set(usage.turnId, usage.snapshot);
        return [];
      }

      case "turn/completed": {
        const params = asTurnCompletedNotification(notification.params);
        if (!params || params.turn.id !== this.activeTurnId) return [];
        const failed = params.turn.status === "failed";
        return this.completeTurn(
          failed ? (params.turn.error?.message ?? "Codex turn failed") : undefined,
        );
      }

      case "error": {
        const params = asErrorNotification(notification.params);
        if (!params || params.turnId !== this.activeTurnId) return [];
        // Codex retries some failures itself; those are news, not the end.
        if (params.willRetry) {
          return [
            {
              type: "notice",
              key: `retry-${params.turnId}`,
              level: "info",
              text: `${params.error.message}（正在重试）`,
            },
          ];
        }
        return this.completeTurn(params.error.message || "Codex turn failed");
      }

      case "item/started":
      case "item/completed": {
        const params =
          notification.method === "item/started"
            ? asItemStartedNotification(notification.params)
            : asItemCompletedNotification(notification.params);
        if (!params) return [];
        const item = normalizeThreadItem(params.item);
        return item ? this.item(item, params.turnId, notification.method) : [];
      }

      // Rate-limit snapshots are telemetry; real quota failures arrive as `error`.
      default:
        return [];
    }
  }

  private item(item: NormalizedThreadItem, turnId: string, phase: ItemPhase): AgentEvent[] {
    const complete = phase === "item/completed";
    const key = itemKey(item.id, turnId);

    switch (item.type) {
      case "reasoning":
        return this.turn.textSnapshot("reasoning", key, item.text);

      case "agent_message":
        return this.turn.textSnapshot("text", key, item.text);

      case "command_execution": {
        const invocation = normalizeCodexToolInvocation("Bash", { command: item.command });
        const events = this.turn.toolCall(item.id, invocation.toolName, invocation.input);
        if (!complete || item.status === "in_progress") return events;
        const context: CodexToolCallContext = {
          toolName: invocation.toolName,
          input: invocation.input,
          readShellInfo: invocation.readShellInfo,
          writeShellInfo: invocation.writeShellInfo,
        };
        const result = normalizeCodexCommandExecutionOutput(
          {
            aggregatedOutput: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status,
          },
          context,
        );
        return [
          ...events,
          ...this.turn.toolResult(
            item.id,
            result.content,
            result.isError === true,
            result.structured,
          ),
        ];
      }

      case "file_change": {
        const input: Record<string, unknown> = { changes: item.changes };
        const onlyPath = item.changes.length === 1 ? item.changes[0]?.path : undefined;
        if (onlyPath) input.file_path = onlyPath;
        const events = this.turn.toolCall(item.id, "Edit", input);
        if (!complete) return events;
        return [...events, ...this.turn.toolResult(item.id, fileChangeSummary(item), false)];
      }

      case "mcp_tool_call": {
        const events = this.turn.toolCall(item.id, `${item.server}:${item.tool}`, item.arguments);
        if (!complete || item.status === "in_progress") return events;
        const succeeded = item.status === "completed";
        const output = succeeded
          ? JSON.stringify(item.result)
          : item.error?.message || "MCP tool call failed";
        return [...events, ...this.turn.toolResult(item.id, output, !succeeded)];
      }

      case "web_search": {
        const events = this.turn.toolCall(item.id, "WebSearch", { query: item.query });
        if (!complete) return events;
        return [
          ...events,
          ...this.turn.toolResult(item.id, `Search completed for: ${item.query}`, false, {
            query: item.query,
            results: [],
            durationSeconds: 0,
          }),
        ];
      }

      case "image_view": {
        const events = this.turn.toolCall(item.id, "ViewImage", { path: item.path });
        if (!complete) return events;
        return [...events, ...this.turn.toolResult(item.id, `Viewed image: ${item.path}`, false)];
      }

      case "error":
        // A non-fatal error reported inside the turn; the turn keeps going.
        return [{ type: "notice", key, level: "error", text: item.message }];

      // The plan checklist has no counterpart in the shared model yet.
      case "todo_list":
        return [];

      default:
        return [];
    }
  }
}
