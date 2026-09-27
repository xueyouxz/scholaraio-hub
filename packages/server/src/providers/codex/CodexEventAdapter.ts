/**
 * Codex app-server event conversion.
 *
 * Turns app-server JSON-RPC notifications into AgentEvent, the provider-neutral
 * model in `providers/events.ts`. Kept apart from the provider so the mapping
 * can be tested on its own (see test/sdk/codex-conversion.golden.test.ts) and so
 * transport concerns never leak into it.
 *
 * Codex vocabulary (thread items, turn ids, snake/camel status strings) stops
 * here. Tool invocations are canonicalized to the shared tool vocabulary
 * (Read / Edit / Bash / WebSearch …) via `codex/normalization.ts`.
 */

import type { SessionContextUsage } from "@scholaraio-hub/shared";
import { TurnState } from "../TurnState.js";
import { type AgentEvent, type TokenUsage, inSubagent } from "../events.js";
import type { JsonRpcNotification } from "./CodexAppServerClient.js";
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
} from "./protocol/index.js";
import {
  type CodexToolCallContext,
  normalizeCodexCommandExecutionOutput,
  normalizeCodexToolInvocation,
} from "./shell-tools.js";

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
  | {
      id: string;
      type: "collab_agent";
      tool: string;
      status: string;
      prompt: string | null;
      receiverThreadIds: string[];
      agentsStates: Record<string, { status: string; message: string | null }>;
    }
  | { id: string; type: "image_view"; path: string };

/** Tokens Codex treats as always present (system prompt, tools); see codex-rs TokenUsage. */
const CODEX_BASELINE_TOKENS = 12_000;

/**
 * Codex's "% context left", computed as codex-rs `percent_of_context_window_remaining`
 * does: both the window and the usage are measured above a fixed baseline.
 */
export function codexContextUsage(totalTokens: number, contextWindow: number): SessionContextUsage {
  let percent = 0;
  if (contextWindow > CODEX_BASELINE_TOKENS) {
    const effectiveWindow = contextWindow - CODEX_BASELINE_TOKENS;
    const used = Math.max(totalTokens - CODEX_BASELINE_TOKENS, 0);
    const remaining = Math.max(effectiveWindow - used, 0);
    percent = Math.round(Math.min(Math.max((remaining / effectiveWindow) * 100, 0), 100));
  }
  return { usedTokens: totalTokens, contextWindow, percent, display: "remaining" };
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

    case "collab_agent_tool_call": {
      const receivers = Array.isArray(itemRecord.receiverThreadIds)
        ? itemRecord.receiverThreadIds.filter(
            (thread): thread is string => typeof thread === "string",
          )
        : [];
      const states: Record<string, { status: string; message: string | null }> = {};
      const rawStates =
        itemRecord.agentsStates && typeof itemRecord.agentsStates === "object"
          ? (itemRecord.agentsStates as Record<string, unknown>)
          : {};
      for (const [thread, value] of Object.entries(rawStates)) {
        const state = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const status = getOptionalString(state.status);
        if (status) states[thread] = { status, message: getOptionalString(state.message) };
      }
      return {
        id,
        type: "collab_agent",
        tool: getOptionalString(itemRecord.tool) ?? "unknown",
        status: getOptionalString(itemRecord.status) ?? "unknown",
        prompt: getOptionalString(itemRecord.prompt),
        receiverThreadIds: receivers,
        agentsStates: states,
      };
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

interface DeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  summaryIndex?: number;
}

/** The shared shape of Codex's per-item streaming notifications. */
function asDeltaParams(params: unknown): DeltaParams | null {
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : null;
  if (
    typeof record?.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.itemId !== "string" ||
    typeof record.delta !== "string"
  ) {
    return null;
  }
  return record as unknown as DeltaParams;
}

/** First line of `text`, cut to `length`. */
function truncateLine(text: string, length: number): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > length ? `${line.slice(0, length)}…` : line;
}

type TodoStatus = "pending" | "in_progress" | "completed";

/** Claude Code's TodoWrite input, the canonical shape for any plan. */
function todoWriteInput(todos: { content: string; status: TodoStatus }[]) {
  return { todos: todos.map((todo) => ({ ...todo, activeForm: todo.content })) };
}

/** `turn/plan/updated`: the agent's step list with per-step status. */
function asPlanUpdate(params: unknown): {
  turnId: string;
  explanation?: string | null;
  plan: { step: string; status: string }[];
} | null {
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : null;
  if (typeof record?.turnId !== "string" || !Array.isArray(record.plan)) return null;
  const plan = record.plan.filter(
    (entry): entry is { step: string; status: string } =>
      !!entry &&
      typeof (entry as { step?: unknown }).step === "string" &&
      typeof (entry as { status?: unknown }).status === "string",
  );
  return {
    turnId: record.turnId,
    explanation: typeof record.explanation === "string" ? record.explanation : null,
    plan,
  };
}

function todoStatus(status: string): TodoStatus {
  if (status === "inProgress" || status === "in_progress") return "in_progress";
  return status === "completed" ? "completed" : "pending";
}

/**
 * Dedup state for one thread: the session's own, or a subagent's. Items from a
 * child thread are reported inside the tool call that spawned it.
 */
interface ThreadScope {
  turn: TurnState;
  /** Last reasoning summary part seen per block, to separate parts. */
  summaryIndex: Map<string, number>;
  parentCallId?: string;
}

function newScope(parentCallId?: string): ThreadScope {
  return { turn: new TurnState(), summaryIndex: new Map(), parentCallId };
}

const FINISHED_AGENT = new Set(["completed", "errored", "shutdown", "notFound"]);

/**
 * Stateful: one adapter per app-server thread. Tracks the open turn so exactly
 * one `turn.completed` is produced per turn, whichever of `turn/completed`, an
 * `error` notification or a failed `turn/start` ends it.
 */
export class CodexEventAdapter {
  private root = newScope();
  /** Child threads started by `spawnAgent`, keyed by thread id. */
  private children = new Map<string, ThreadScope>();
  /** Which spawn call started each child thread, for reporting its outcome. */
  private spawnedBy = new Map<string, string>();
  private usageByTurnId = new Map<string, TokenUsageSnapshot>();
  private activeTurnId: string | null = null;
  /** Plan updates so far this turn; each becomes its own TodoWrite call. */
  private planUpdates = 0;

  constructor(private sessionId = "") {}

  /** The thread is ready; announce its id. */
  started(sessionId: string): AgentEvent[] {
    this.sessionId = sessionId;
    return [{ type: "session.started", sessionId }];
  }

  beginTurn(turnId: string): void {
    this.activeTurnId = turnId;
  }

  /** The turn running now, until its terminal notification (or completeTurn) ends it. */
  get activeTurn(): string | null {
    return this.activeTurnId;
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
    this.root = newScope();
    for (const [thread, scope] of this.children)
      this.children.set(thread, newScope(scope.parentCallId));
    this.planUpdates = 0;
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
    switch (notification.method) {
      // Plan-mode text streams exactly like an answer; the "plan" item
      // snapshot then lands on the same block (see normalizeThreadItem).
      case "item/agentMessage/delta":
      case "item/plan/delta": {
        const params = asDeltaParams(notification.params);
        const scope = params && this.scopeFor(params.threadId);
        if (!params || !scope) return [];
        return inSubagent(
          scope.turn.textDelta("text", itemKey(params.itemId, params.turnId), params.delta),
          scope.parentCallId,
        );
      }

      case "item/reasoning/summaryTextDelta": {
        const params = asDeltaParams(notification.params);
        const scope = params && this.scopeFor(params.threadId);
        if (!params || !scope) return [];
        const key = itemKey(params.itemId, params.turnId);
        const index = params.summaryIndex ?? 0;
        const previous = scope.summaryIndex.get(key);
        scope.summaryIndex.set(key, index);
        // Summary parts join with a newline, matching the completed item text.
        const separator = previous !== undefined && previous !== index ? "\n" : "";
        return inSubagent(
          scope.turn.textDelta("reasoning", key, separator + params.delta),
          scope.parentCallId,
        );
      }

      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta": {
        const params = asDeltaParams(notification.params);
        const scope = params && this.scopeFor(params.threadId);
        if (!params || !scope) return [];
        return inSubagent(
          scope.turn.toolOutputDelta(params.itemId, params.delta),
          scope.parentCallId,
        );
      }

      case "turn/plan/updated": {
        const params = asPlanUpdate(notification.params);
        if (!params || params.turnId !== this.activeTurnId) return [];
        const callId = `plan-${params.turnId}-${++this.planUpdates}`;
        const input = todoWriteInput(
          params.plan.map((entry) => ({ content: entry.step, status: todoStatus(entry.status) })),
        );
        return [
          ...this.root.turn.toolCall(callId, "TodoWrite", input),
          ...this.root.turn.toolResult(callId, "Plan updated", false),
        ];
      }

      case "thread/tokenUsage/updated": {
        const usage = extractTurnUsage(notification.params);
        if (usage) this.usageByTurnId.set(usage.turnId, usage.snapshot);
        const update = asThreadTokenUsageUpdatedNotification(notification.params);
        const window = update?.tokenUsage.modelContextWindow;
        const total = update?.tokenUsage.last.totalTokens;
        // Subagent threads have their own windows; the meter is the main thread's.
        if (
          !update ||
          !window ||
          typeof total !== "number" ||
          (this.sessionId && update.threadId !== this.sessionId)
        )
          return [];
        return [
          {
            type: "context.usage",
            usage: codexContextUsage(total, window),
          },
        ];
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
              text: `${params.error.message} (retrying)`,
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
        const scope = params && this.scopeFor(params.threadId);
        if (!params || !scope) return [];
        const item = normalizeThreadItem(params.item);
        if (!item) return [];
        return inSubagent(
          this.item(scope, item, params.turnId, notification.method),
          scope.parentCallId,
        );
      }

      // Rate-limit snapshots are telemetry; real quota failures arrive as `error`.
      default:
        return [];
    }
  }

  /** The session's own thread, a known child thread, or null for anything else. */
  private scopeFor(threadId: string): ThreadScope | null {
    if (threadId === this.sessionId) return this.root;
    return this.children.get(threadId) ?? null;
  }

  /** `spawnAgent` becomes a Task call; the other collab tools report on it. */
  private collab(
    scope: ThreadScope,
    item: Extract<NormalizedThreadItem, { type: "collab_agent" }>,
    complete: boolean,
  ): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (item.tool === "spawnAgent") {
      for (const thread of item.receiverThreadIds) {
        this.spawnedBy.set(thread, item.id);
        if (!this.children.has(thread)) this.children.set(thread, newScope(item.id));
      }
      const prompt = item.prompt ?? "";
      events.push(
        ...scope.turn.toolCall(item.id, "Task", {
          description: truncateLine(prompt, 60),
          prompt,
          subagent_type: "codex",
        }),
      );
      if (complete && item.status === "failed") {
        events.push(...scope.turn.toolResult(item.id, "Failed to start the agent", true));
      }
    }
    // Any collab call may carry agents' latest states; a finished agent
    // settles the Task call that started it.
    for (const [thread, state] of Object.entries(item.agentsStates)) {
      const spawnCall = this.spawnedBy.get(thread);
      if (!spawnCall || !FINISHED_AGENT.has(state.status)) continue;
      const failed = state.status === "errored" || state.status === "notFound";
      events.push(
        ...scope.turn.toolResult(spawnCall, state.message ?? `Agent ${state.status}`, failed),
      );
    }
    return events;
  }

  private item(
    scope: ThreadScope,
    item: NormalizedThreadItem,
    turnId: string,
    phase: ItemPhase,
  ): AgentEvent[] {
    const turn = scope.turn;
    const complete = phase === "item/completed";
    const key = itemKey(item.id, turnId);

    switch (item.type) {
      case "reasoning":
        return turn.textSnapshot("reasoning", key, item.text);

      case "agent_message":
        return turn.textSnapshot("text", key, item.text);

      case "command_execution": {
        const invocation = normalizeCodexToolInvocation("Bash", { command: item.command });
        const events = turn.toolCall(item.id, invocation.toolName, invocation.input);
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
          ...turn.toolResult(item.id, result.content, result.isError === true, result.structured),
        ];
      }

      case "file_change": {
        const input: Record<string, unknown> = { changes: item.changes };
        const onlyPath = item.changes.length === 1 ? item.changes[0]?.path : undefined;
        if (onlyPath) input.file_path = onlyPath;
        const events = turn.toolCall(item.id, "Edit", input);
        if (!complete) return events;
        return [...events, ...turn.toolResult(item.id, fileChangeSummary(item), false)];
      }

      case "mcp_tool_call": {
        const events = turn.toolCall(item.id, `${item.server}:${item.tool}`, item.arguments);
        if (!complete || item.status === "in_progress") return events;
        const succeeded = item.status === "completed";
        const output = succeeded
          ? JSON.stringify(item.result)
          : item.error?.message || "MCP tool call failed";
        return [...events, ...turn.toolResult(item.id, output, !succeeded)];
      }

      case "web_search": {
        const events = turn.toolCall(item.id, "WebSearch", { query: item.query });
        if (!complete) return events;
        return [
          ...events,
          ...turn.toolResult(item.id, `Search completed for: ${item.query}`, false, {
            query: item.query,
            results: [],
            durationSeconds: 0,
          }),
        ];
      }

      case "image_view": {
        const events = turn.toolCall(item.id, "ViewImage", { path: item.path });
        if (!complete) return events;
        return [...events, ...turn.toolResult(item.id, `Viewed image: ${item.path}`, false)];
      }

      case "collab_agent":
        return this.collab(scope, item, complete);

      case "error":
        // A non-fatal error reported inside the turn; the turn keeps going.
        return [{ type: "notice", key, level: "error", text: item.message }];

      case "todo_list": {
        // The list can change between started and completed; report the final one.
        if (!complete) return [];
        const input = todoWriteInput(
          item.items.map((entry) => ({
            content: entry.text,
            status: entry.completed ? "completed" : "pending",
          })),
        );
        return [
          ...turn.toolCall(item.id, "TodoWrite", input),
          ...turn.toolResult(item.id, "Plan updated", false),
        ];
      }

      default:
        return [];
    }
  }
}
