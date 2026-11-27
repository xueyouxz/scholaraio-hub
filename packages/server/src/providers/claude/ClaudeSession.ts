/**
 * One Claude conversation on one Claude Code CLI, driven through the Agent
 * SDK's `query()`: the hub's messages go in as its prompt, its messages come
 * out as AgentEvents, and the session's controls (interrupt, permission mode,
 * thinking) act on the same query. The CLI is spawned here so its handle is
 * kept: liveness, stderr and termination come from it.
 */

import { readFile } from "node:fs/promises";
import {
  type Query,
  type CanUseTool as SDKCanUseTool,
  type SDKUserMessage,
  type ThinkingConfig as SdkThinkingConfig,
  type SpawnOptions,
  type SpawnedProcess,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionContextUsage, ThinkingConfig } from "@scholaraio-hub/shared";
import { loggerFor } from "../../logging/logger.js";
import { withTimeout } from "../../utils/timeout.js";
import { MessageQueue, describeAttachments, isInlineImage } from "../MessageQueue.js";
import { CliProcess } from "../cli-process.js";
import type { AgentEvent } from "../events.js";
import { traceProviderMessage } from "../trace.js";
import type {
  AgentSession,
  CanUseTool,
  PermissionMode,
  StartSessionOptions,
  UserMessage,
} from "../types.js";
import { ClaudeEventAdapter } from "./ClaudeEventAdapter.js";
import type { SDKMessage } from "./sdk-message.js";

const log = () => loggerFor("claude-session");

/** A user message as Claude Code sends one: text naming every file by path, images also inline. */
export async function toClaudeUserMessage(message: UserMessage): Promise<SDKUserMessage> {
  const text = message.text + describeAttachments(message.attachments);
  const images = await Promise.all(
    (message.attachments ?? []).filter(isInlineImage).map(async (file) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: file.mimeType,
        data: (await readFile(file.path)).toString("base64"),
      },
    })),
  );
  return {
    type: "user",
    uuid: message.uuid, // The SDK keeps the id we recorded the message under.
    message: {
      role: "user",
      content: images.length ? [{ type: "text", text }, ...images] : text,
    },
  } as SDKUserMessage;
}

/** A session's queued messages as the SDK reads its prompt. */
export async function* claudePrompt(queue: MessageQueue): AsyncGenerator<SDKUserMessage> {
  for await (const message of queue.messages()) yield await toClaudeUserMessage(message);
}
/** How the session's CLI is started. */
export interface ClaudeLaunch {
  /** The Claude Code executable; undefined lets the SDK find its own. */
  executable?: string;
  env: Record<string, string | undefined>;
}

export class ClaudeSession implements AgentSession {
  readonly queue = new MessageQueue();
  readonly events: AsyncIterableIterator<AgentEvent>;
  private readonly abortController = new AbortController();
  private readonly sdkQuery: Query;
  /** The CLI once the SDK has asked for it to be spawned. */
  private cli: CliProcess | null = null;

  constructor(options: StartSessionOptions, launch: ClaudeLaunch) {
    // Without a first message the CLI waits until one is pushed.
    if (options.initialMessage) this.queue.push(options.initialMessage);
    try {
      this.sdkQuery = query({
        prompt: claudePrompt(this.queue),
        options: {
          cwd: options.cwd,
          ...(options.additionalDirectories?.length
            ? { additionalDirectories: options.additionalDirectories }
            : {}),
          resume: options.resumeSessionId,
          ...(options.resumeSessionId && options.resumeAt
            ? { resumeSessionAt: options.resumeAt }
            : {}),
          abortController: this.abortController,
          permissionMode: toClaudePermissionMode(options.permissionMode),
          canUseTool: options.onToolApproval && toSdkCanUseTool(options.onToolApproval),
          systemPrompt: { type: "preset", preset: "claude_code" },
          settingSources: ["user", "project", "local"],
          includePartialMessages: true,
          model: options.model,
          thinking: toClaudeThinking(options.thinking),
          effort: toClaudeEffort(options.effort),
          env: launch.env,
          pathToClaudeCodeExecutable: launch.executable,
          spawnClaudeCodeProcess: (spawnOptions) => this.spawn(spawnOptions),
        },
      });
    } catch (error) {
      throw startError(error);
    }
    this.events = this.toAgentEvents();
    this.warmContextUsage();
  }

  /**
   * Claude Code's first `/context` count in a process takes over a second; take
   * it now, alongside the first turn, so the count at each turn's end is quick.
   * It settles when the query closes, so nothing outlives the session.
   */
  private warmContextUsage(): void {
    this.sdkQuery
      .initializationResult()
      .then(() => this.sdkQuery.getContextUsage())
      .catch((error) => log().debug({ err: error }, "Context usage warm-up failed"));
  }

  abort(): Promise<void> {
    this.abortController.abort();
    this.queue.close();
    return this.cli?.terminate() ?? Promise.resolve();
  }

  isProcessAlive(): boolean {
    return this.cli?.isAlive() ?? false;
  }

  async interrupt(): Promise<void> {
    await this.sdkQuery.interrupt();
  }

  /**
   * On adaptive models any non-zero budget means "adaptive" and 0 turns
   * thinking off; null would only clear the limit.
   */
  setThinking(thinking: ThinkingConfig | undefined): Promise<void> {
    return this.sdkQuery.setMaxThinkingTokens(thinking?.type === "disabled" ? 0 : 1);
  }

  /** The CLI's own mode shapes its prompt (plan mode keeps it planning). */
  setPermissionMode(mode: PermissionMode): void {
    this.sdkQuery.setPermissionMode(toClaudePermissionMode(mode)).catch((error) => {
      log().warn({ err: error, mode }, "Claude permission mode change failed");
    });
  }

  /**
   * Spawn the CLI ourselves to keep its handle: stale detection can then tell
   * "process died silently" from "process is busy with a long tool call", and
   * its stderr says why it failed (a resume that no longer exists, a broken config).
   */
  private spawn(spawnOptions: SpawnOptions): SpawnedProcess {
    const cli = CliProcess.spawn(spawnOptions.command, spawnOptions.args, {
      cwd: spawnOptions.cwd,
      env: spawnOptions.env as NodeJS.ProcessEnv,
    });
    const { signal } = spawnOptions;
    const onAbort = () => void cli.terminate();
    signal.addEventListener("abort", onAbort);
    cli.child.on("exit", (code, exitSignal) => {
      signal.removeEventListener("abort", onAbort);
      // Our own abort ends it with SIGTERM (exit 143): not worth a warning.
      if (code && !signal.aborted)
        log().warn({ code, signal: exitSignal, stderr: cli.stderrTail }, "Claude CLI exited");
    });
    this.cli = cli;
    return cli.child;
  }

  /**
   * Translate the SDK stream into AgentEvents. The raw SDK message is logged
   * (when LOG_SDK_MESSAGES is on) but never forwarded.
   */
  private async *toAgentEvents(): AsyncIterableIterator<AgentEvent> {
    const adapter = new ClaudeEventAdapter();
    let sessionId = "unknown";
    try {
      for await (const message of this.sdkQuery) {
        sessionId = (message as { session_id?: string }).session_id ?? sessionId;
        traceProviderMessage("claude", sessionId, message);
        for (const event of adapter.accept(message as unknown as SDKMessage)) {
          // Report the window as `/context` counts it before the turn closes.
          if (event.type === "turn.completed" && !event.parentCallId) {
            const usage =
              (await readClaudeContextUsage(this.sdkQuery)) ??
              estimateClaudeContextUsage(adapter.promptTokens, event.contextWindow);
            if (usage) yield { type: "context.usage", usage };
          }
          yield event;
        }
      }
    } catch (error) {
      // An abort is how a session ends normally.
      if (error instanceof Error && error.name === "AbortError") return;
      // Transport failures ("ProcessTransport is not ready for writing") are
      // the AgentProcess to classify; what the CLI last printed says why.
      const tail = this.cli?.stderrTail;
      if (tail && error instanceof Error)
        throw new Error(`${error.message}\n${tail}`, { cause: error });
      throw error;
    }
  }
}

/** The hub's approval callback in the shape the SDK calls it. */
function toSdkCanUseTool(onToolApproval: CanUseTool): SDKCanUseTool {
  return async (toolName, input, options) => {
    const result = await onToolApproval(toolName, input, options);
    log().debug({ toolName, behavior: result.behavior }, "Tool approval");
    if (result.behavior === "allow")
      return {
        behavior: "allow",
        updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
      };
    return {
      behavior: "deny",
      message: result.message ?? "Permission denied",
      interrupt: result.interrupt,
    };
  };
}

/** What a failed `query()` start means to the user. */
function startError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.includes("Claude Code executable not found"))
    return new Error("未找到 Claude CLI，请先安装：curl -fsSL https://claude.ai/install.sh | bash");
  if (error.message.includes("SPAWN") || error.message.includes("spawn"))
    return new Error(`Unable to start Claude CLI: ${error.message}`);
  return error;
}

/**
 * The mode the CLI runs under. It only shapes the CLI's prompt; the decision
 * always comes back to canUseTool. bypassPermissions goes in as "default" so
 * the CLI cannot answer on its own — see supervisor/permission-policy.ts.
 */
function toClaudePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  return !mode || mode === "bypassPermissions" ? "default" : mode;
}

/** Ask for summarized thinking: by default the model may omit it and leave reasoning empty. */
function toClaudeThinking(thinking?: ThinkingConfig): SdkThinkingConfig | undefined {
  return thinking && thinking.type !== "disabled"
    ? { ...thinking, display: "summarized" }
    : thinking;
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

function toClaudeEffort(effort?: string): (typeof CLAUDE_EFFORTS)[number] | undefined {
  return CLAUDE_EFFORTS.find((known) => known === effort);
}

/**
 * The turn's end waits for this read, so it stays well under the time a Stop
 * waits for the turn to settle (SessionService's STOP_SETTLE_MS) before it
 * kills the CLI instead.
 */
const CONTEXT_USAGE_TIMEOUT_MS = 1500;

/** Claude Code's own `/context` numbers; undefined when the CLI cannot answer in time. */
export async function readClaudeContextUsage(
  sdkQuery: Pick<Query, "getContextUsage">,
): Promise<SessionContextUsage | undefined> {
  try {
    const usage = await withTimeout(
      sdkQuery.getContextUsage(),
      CONTEXT_USAGE_TIMEOUT_MS,
      "timed out",
    );
    return {
      usedTokens: usage.totalTokens,
      contextWindow: usage.maxTokens,
      percent: usage.percentage,
      display: "used",
      ...(usage.isAutoCompactEnabled && usage.autoCompactThreshold
        ? { autoCompactThreshold: usage.autoCompactThreshold }
        : {}),
    };
  } catch (error) {
    log().warn({ err: error }, "Context usage unavailable; estimating it from the last request");
    return undefined;
  }
}

/**
 * The window's fill as the main agent's last API request measured it: what
 * `/context` would count, less the reply not yet sent back. Undefined without
 * both numbers.
 */
export function estimateClaudeContextUsage(
  promptTokens: number | undefined,
  contextWindow: number | undefined,
): SessionContextUsage | undefined {
  if (promptTokens === undefined || !contextWindow) return undefined;
  return {
    usedTokens: promptTokens,
    contextWindow,
    percent: Math.min(100, Math.round((promptTokens / contextWindow) * 100)),
    display: "used",
  };
}
