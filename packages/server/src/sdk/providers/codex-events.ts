/**
 * Codex app-server event conversion.
 *
 * Pure functions that turn app-server JSON-RPC notifications into the internal
 * SDKMessage stream. Kept apart from the provider so the mapping can be tested
 * on its own (see test/sdk/codex-conversion.golden.test.ts) and so transport
 * concerns never leak into it.
 */

import {
  isCodexCorrelationDebugEnabled,
  logCodexCorrelationDebug,
  summarizeCodexNormalizedMessage,
} from "../../codex/correlationDebugLogger.js";
import {
  type CodexToolCallContext,
  normalizeCodexCommandExecutionOutput,
  normalizeCodexToolInvocation,
} from "../../codex/normalization.js";
import type { SDKMessage, TimestampedSDKMessage, UserMessage } from "../types.js";
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

export function logSdkCorrelationDebug(
  sessionId: string,
  message: SDKMessage,
  metadata: {
    eventKind?: string;
    turnId?: string;
    itemId?: string;
    callId?: string;
    phase?: string;
    sourceEvent?: string;
    status?: string;
  } = {},
): void {
  if (!isCodexCorrelationDebugEnabled()) return;
  logCodexCorrelationDebug({
    sessionId,
    channel: "sdk",
    authority: "transient",
    ...metadata,
    ...summarizeCodexNormalizedMessage(message),
  });
}

export function withCodexTimestamp<T extends SDKMessage>(
  message: T,
  timestamp = new Date().toISOString(),
): TimestampedSDKMessage<T> {
  if (typeof message.timestamp === "string" && message.timestamp.trim().length > 0) {
    return message as TimestampedSDKMessage<T>;
  }
  return {
    ...message,
    timestamp,
  } as TimestampedSDKMessage<T>;
}

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

export function convertNotificationToSDKMessages(
  notification: JsonRpcNotification,
  sessionId: string,
  usageByTurnId: Map<string, TokenUsageSnapshot>,
): SDKMessage[] {
  switch (notification.method) {
    case "item/agentMessage/delta": {
      const params = notification.params as Record<string, unknown> | undefined;
      if (
        params?.threadId !== sessionId ||
        typeof params?.itemId !== "string" ||
        typeof params?.turnId !== "string" ||
        typeof params?.delta !== "string"
      )
        return [];
      return [
        {
          type: "text_delta",
          session_id: sessionId,
          uuid: `${params.itemId}-${params.turnId}`,
          delta: params.delta,
        },
      ];
    }

    case "turn/completed": {
      const params = asTurnCompletedNotification(notification.params);
      const turnId = params?.turn.id ?? null;
      const usage = turnId ? usageByTurnId.get(turnId) : undefined;
      const message = withCodexTimestamp({
        type: "system",
        subtype: "turn_complete",
        session_id: sessionId,
        usage: usage
          ? {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cached_input_tokens: usage.cachedInputTokens,
            }
          : undefined,
      } as SDKMessage);
      logSdkCorrelationDebug(sessionId, message, {
        eventKind: "turn_complete",
        ...(turnId ? { turnId } : {}),
        phase: "completed",
        sourceEvent: notification.method,
      });
      return [message];
    }

    case "error": {
      const params = asErrorNotification(notification.params);
      const errorMessage = params?.error.message;
      const message =
        (typeof errorMessage === "string" && errorMessage) ||
        (typeof (notification.params as { message?: unknown })?.message === "string"
          ? (notification.params as { message: string }).message
          : "Codex turn failed");

      const errorEvent = {
        type: "error",
        session_id: sessionId,
        error: message,
      } as SDKMessage;
      logSdkCorrelationDebug(sessionId, errorEvent, {
        eventKind: "error",
        phase: "emitted",
        sourceEvent: notification.method,
      });
      return [errorEvent];
    }

    case "item/started":
    case "item/completed": {
      const params =
        notification.method === "item/started"
          ? asItemStartedNotification(notification.params)
          : asItemCompletedNotification(notification.params);
      if (!params) return [];

      const normalized = normalizeThreadItem(params.item);
      if (!normalized) {
        return [];
      }

      const turnId = params.turnId;

      return convertItemToSDKMessages(normalized, sessionId, turnId, notification.method);
    }

    case "account/rateLimits/updated": {
      // account/rateLimits/updated is telemetry, not a terminal turn error.
      // Real usage-limit/quota failures arrive via the `error` notification.
      return [];
    }

    default:
      return [];
  }
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

/**
 * Convert a normalized thread item to SDKMessage(s).
 */
export function convertItemToSDKMessages(
  item: NormalizedThreadItem,
  sessionId: string,
  turnId: string,
  sourceEvent: "item/started" | "item/completed",
): SDKMessage[] {
  const isComplete = sourceEvent === "item/completed";
  const observedAt = new Date().toISOString();
  // Create unique UUID by combining item.id with turn ID.
  const uuid = `${item.id}-${turnId}`;

  switch (item.type) {
    case "reasoning": {
      const message = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: item.text,
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, message, {
        eventKind: "reasoning",
        turnId,
        itemId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      return [message];
    }

    case "agent_message": {
      const message = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: item.text,
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, message, {
        eventKind: "agent_message",
        turnId,
        itemId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      return [message];
    }

    case "command_execution": {
      const messages: SDKMessage[] = [];
      const normalizedInvocation = normalizeCodexToolInvocation("Bash", {
        command: item.command,
      });
      const toolContext: CodexToolCallContext = {
        toolName: normalizedInvocation.toolName,
        input: normalizedInvocation.input,
        readShellInfo: normalizedInvocation.readShellInfo,
        writeShellInfo: normalizedInvocation.writeShellInfo,
      };

      // Emit tool_use for the command
      const toolUseMessage = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: item.id,
                name: normalizedInvocation.toolName,
                input: normalizedInvocation.input,
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, toolUseMessage, {
        eventKind: "command_execution",
        turnId,
        itemId: item.id,
        callId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
        status: item.status,
      });
      messages.push(toolUseMessage);

      // If completed, emit tool_result
      if (isComplete && item.status !== "in_progress") {
        const normalizedResult = normalizeCodexCommandExecutionOutput(
          {
            aggregatedOutput: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status,
          },
          toolContext,
        );
        const toolResultBlock: {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        } = {
          type: "tool_result",
          tool_use_id: item.id,
          content: normalizedResult.content,
        };
        if (normalizedResult.isError) {
          toolResultBlock.is_error = true;
        }

        const toolResultMessage = withCodexTimestamp(
          {
            type: "user",
            session_id: sessionId,
            uuid: `${uuid}-result`,
            message: {
              role: "user",
              content: [toolResultBlock],
            },
            ...(normalizedResult.structured !== undefined
              ? { toolUseResult: normalizedResult.structured }
              : {}),
          } as SDKMessage,
          observedAt,
        );
        logSdkCorrelationDebug(sessionId, toolResultMessage, {
          eventKind: "tool_result",
          turnId,
          itemId: item.id,
          callId: item.id,
          phase: "completed",
          sourceEvent,
          status: item.status,
        });
        messages.push(toolResultMessage);
      }

      return messages;
    }

    case "file_change": {
      const changesSummary = item.changes.map((c) => `${c.kind}: ${c.path}`).join("\n");
      const editInput: Record<string, unknown> = {
        changes: item.changes,
      };
      const singlePath = item.changes[0]?.path;
      if (singlePath && item.changes.length === 1) {
        editInput.file_path = singlePath;
      }

      const toolUseMessage = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: item.id,
                name: "Edit",
                input: editInput,
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, toolUseMessage, {
        eventKind: "file_change",
        turnId,
        itemId: item.id,
        callId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
        status: item.status,
      });

      const messages = [toolUseMessage];

      if (isComplete) {
        const toolResultMessage = withCodexTimestamp(
          {
            type: "user",
            session_id: sessionId,
            uuid: `${uuid}-result`,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: item.id,
                  content:
                    item.status === "completed"
                      ? `File changes applied:\n${changesSummary}`
                      : item.status === "declined"
                        ? `File changes declined:\n${changesSummary}`
                        : `File changes failed:\n${changesSummary}`,
                },
              ],
            },
          } as SDKMessage,
          observedAt,
        );
        logSdkCorrelationDebug(sessionId, toolResultMessage, {
          eventKind: "tool_result",
          turnId,
          itemId: item.id,
          callId: item.id,
          phase: "completed",
          sourceEvent,
          status: item.status,
        });
        messages.push(toolResultMessage);
      }

      return messages;
    }

    case "mcp_tool_call": {
      const messages: SDKMessage[] = [];

      const toolUseMessage = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: item.id,
                name: `${item.server}:${item.tool}`,
                input: item.arguments,
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, toolUseMessage, {
        eventKind: "mcp_tool_call",
        turnId,
        itemId: item.id,
        callId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
        status: item.status,
      });
      messages.push(toolUseMessage);

      if (isComplete && item.status !== "in_progress") {
        const toolResultMessage = withCodexTimestamp(
          {
            type: "user",
            session_id: sessionId,
            uuid: `${uuid}-result`,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: item.id,
                  content:
                    item.status === "completed"
                      ? JSON.stringify(item.result)
                      : item.error?.message || "MCP tool call failed",
                },
              ],
            },
          } as SDKMessage,
          observedAt,
        );
        logSdkCorrelationDebug(sessionId, toolResultMessage, {
          eventKind: "tool_result",
          turnId,
          itemId: item.id,
          callId: item.id,
          phase: "completed",
          sourceEvent,
          status: item.status,
        });
        messages.push(toolResultMessage);
      }

      return messages;
    }

    case "web_search": {
      const messages: SDKMessage[] = [];
      const toolUseMessage = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: item.id,
                name: "WebSearch",
                input: { query: item.query },
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, toolUseMessage, {
        eventKind: "web_search",
        turnId,
        itemId: item.id,
        callId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      messages.push(toolUseMessage);

      if (isComplete) {
        const toolResultMessage = withCodexTimestamp(
          {
            type: "user",
            session_id: sessionId,
            uuid: `${uuid}-result`,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: item.id,
                  content: `Search completed for: ${item.query}`,
                },
              ],
            },
            toolUseResult: {
              query: item.query,
              results: [],
              durationSeconds: 0,
            },
          } as SDKMessage,
          observedAt,
        );
        logSdkCorrelationDebug(sessionId, toolResultMessage, {
          eventKind: "tool_result",
          turnId,
          itemId: item.id,
          callId: item.id,
          phase: "completed",
          sourceEvent,
        });
        messages.push(toolResultMessage);
      }

      return messages;
    }

    case "todo_list": {
      const message = withCodexTimestamp(
        {
          type: "system",
          subtype: "todo_list",
          session_id: sessionId,
          uuid,
          items: item.items,
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, message, {
        eventKind: "todo_list",
        turnId,
        itemId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      return [message];
    }

    case "image_view": {
      // Represent as a ViewImage tool_use + tool_result pair
      const toolUseMessage = withCodexTimestamp(
        {
          type: "assistant",
          session_id: sessionId,
          uuid,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: item.id,
                name: "ViewImage",
                input: { path: item.path },
              },
            ],
          },
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, toolUseMessage, {
        eventKind: "image_view",
        turnId,
        itemId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      const messages: SDKMessage[] = [toolUseMessage];

      if (isComplete) {
        const toolResultMessage = withCodexTimestamp(
          {
            type: "user",
            session_id: sessionId,
            uuid: `${uuid}-result`,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: item.id,
                  content: `Viewed image: ${item.path}`,
                },
              ],
            },
          } as SDKMessage,
          observedAt,
        );
        logSdkCorrelationDebug(sessionId, toolResultMessage, {
          eventKind: "tool_result",
          turnId,
          itemId: item.id,
          callId: item.id,
          phase: "completed",
          sourceEvent,
        });
        messages.push(toolResultMessage);
      }

      return messages;
    }

    case "error": {
      const message = withCodexTimestamp(
        {
          type: "error",
          session_id: sessionId,
          uuid,
          error: item.message,
        } as SDKMessage,
        observedAt,
      );
      logSdkCorrelationDebug(sessionId, message, {
        eventKind: "error",
        turnId,
        itemId: item.id,
        phase: isComplete ? "completed" : "started",
        sourceEvent,
      });
      return [message];
    }

    default:
      return [];
  }
}

/**
 * Extract text content from a user message.
 */
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
