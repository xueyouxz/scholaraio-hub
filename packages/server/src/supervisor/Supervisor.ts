import { randomUUID } from "node:crypto";
import type { ProviderName, ThinkingConfig } from "@scholaraio-hub/shared";
import { getLogger } from "../logging/logger.js";
import { getProvider } from "../providers/index.js";
import type { AgentProvider } from "../providers/types.js";
import type { PermissionMode, UserMessage } from "../providers/types.js";
import { AgentProcess } from "./AgentProcess.js";
import type { ProcessEvent } from "./types.js";

/** How often to check for stale processes (60 seconds) */
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

/** Default in-turn stale threshold for providers with frequent heartbeat/tool events. */
const DEFAULT_STALE_IN_TURN_THRESHOLD_MS = 5 * 60 * 1000;
/** Codex sessions can be silent for long periods during backend retries/reconnects. */
const CODEX_STALE_IN_TURN_THRESHOLD_MS = 60 * 60 * 1000;

function getStaleInTurnThresholdMs(provider: ProviderName): number {
  return provider === "codex"
    ? CODEX_STALE_IN_TURN_THRESHOLD_MS
    : DEFAULT_STALE_IN_TURN_THRESHOLD_MS;
}

/** How a session's worker must run; a live one that differs is replaced. */
export interface LaunchSettings {
  /** Provider to use; undefined is the supervisor's default. */
  providerName?: ProviderName;
  /** Model to use; undefined is the provider's default. */
  model?: string;
  /** Thinking configuration. undefined = provider default */
  thinking?: ThinkingConfig;
  /** Effort level; undefined = provider default */
  effort?: string;
}

/** A message for one of our sessions, with everything its worker must match. */
export interface SessionMessageRequest {
  /** Our session id. */
  sessionId: string;
  /** The provider conversation to continue; none starts a new one. */
  nativeSessionId?: string;
  projectPath: string;
  message: UserMessage;
  permissionMode?: PermissionMode;
  settings?: LaunchSettings;
}

export interface SupervisorOptions {
  /** Agent provider used when a request does not name one */
  provider: AgentProvider;
  idleTimeoutMs?: number;
  /**
   * Every event of every live process, with the session it serves. A process
   * that was released (replaced or deleted) reports nothing more.
   */
  onEvent: (sessionId: string, event: ProcessEvent) => void;
}

/**
 * Owns the provider processes this server runs, one per session and keyed by
 * our own session id. It keeps each live process matching what the session
 * asks for — provider, native conversation, model, thinking, effort — and
 * reaps processes that died without saying so.
 */
export class Supervisor {
  private readonly processes = new Map<string, AgentProcess>();
  private readonly provider: AgentProvider;
  private readonly idleTimeoutMs?: number;
  private readonly onEvent: SupervisorOptions["onEvent"];
  private readonly staleCheckTimer: ReturnType<typeof setInterval>;

  constructor(options: SupervisorOptions) {
    this.provider = options.provider;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.onEvent = options.onEvent;
    this.staleCheckTimer = setInterval(
      () => this.terminateStaleProcesses(),
      STALE_CHECK_INTERVAL_MS,
    );
    this.staleCheckTimer.unref(); // Don't keep process alive for cleanup
  }

  /**
   * The provider that would run a session for `name`: the one the caller named,
   * otherwise the supervisor default. An unknown name is a caller bug.
   */
  providerFor(name: ProviderName | undefined): AgentProvider {
    if (!name || name === this.provider.name) return this.provider;
    const provider = getProvider(name);
    if (!provider) throw new Error(`Unknown provider: ${name}`);
    return provider;
  }

  /** The session's live process, if it has one. */
  get(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId);
  }

  /**
   * Send a message to a session: to its live process when that one still
   * matches the request, otherwise to a new process (resuming the native
   * conversation when there is one).
   */
  async send(request: SessionMessageRequest): Promise<AgentProcess> {
    const live = this.processes.get(request.sessionId);
    if (live && (await this.adopt(live, request))) {
      if (request.permissionMode) live.setPermissionMode(request.permissionMode);
      if (live.queueMessage(request.message).success) return live;
      this.release(request.sessionId, "Process could not take the message");
    }
    return this.launch(request);
  }

  /**
   * Stop the session's process without reporting its ending: whoever releases
   * it is replacing it or removing the session. No-op when there is none.
   */
  release(sessionId: string, reason: string): void {
    const process = this.processes.get(sessionId);
    if (!process) return;
    this.processes.delete(sessionId);
    process.stop(reason);
  }

  close(): void {
    clearInterval(this.staleCheckTimer);
    for (const id of [...this.processes.keys()]) this.release(id, "Server closing");
  }

  /**
   * Bring a live process to what the request needs. Thinking alone can switch
   * in place; any other difference releases the process and returns false.
   */
  private async adopt(process: AgentProcess, request: SessionMessageRequest): Promise<boolean> {
    const settings = request.settings ?? {};
    const reason = process.isTerminated
      ? "Process already ended"
      : this.providerFor(settings.providerName).name !== process.provider
        ? "Provider changed"
        : request.nativeSessionId !== process.nativeSessionId
          ? "Session continues a different conversation"
          : settings.model !== process.model
            ? "Model changed"
            : settings.effort !== process.effort
              ? "Effort changed"
              : process.thinking?.type !== settings.thinking?.type &&
                  !(await process.changeThinking(settings.thinking))
                ? "Thinking changed"
                : undefined;
    if (!reason) return true;
    getLogger().info(
      { event: "process_replaced", sessionId: request.sessionId, processId: process.id, reason },
      `Replacing process for ${request.sessionId}: ${reason}`,
    );
    this.release(request.sessionId, reason);
    return false;
  }

  private async launch(request: SessionMessageRequest): Promise<AgentProcess> {
    const { sessionId, nativeSessionId, projectPath, message } = request;
    const settings = request.settings ?? {};
    const provider = this.providerFor(settings.providerName);
    const permissionMode = request.permissionMode ?? "default";
    // The approval callback is handed over before the process exists.
    const holder: { process?: AgentProcess } = {};
    const session = await provider.startSession({
      cwd: projectPath,
      // The same UUID reaches the provider and our own record of the message.
      initialMessage: { ...message, uuid: randomUUID() },
      resumeSessionId: nativeSessionId,
      permissionMode,
      model: settings.model,
      thinking: settings.thinking,
      effort: settings.effort,
      onToolApproval: async (toolName, input, opts) => {
        if (!holder.process) return { behavior: "deny", message: "Process not ready" };
        return holder.process.handleToolApproval(toolName, input, opts);
      },
    });
    const process = new AgentProcess(session, {
      sessionId,
      nativeSessionId,
      projectPath,
      provider: provider.name,
      permissionMode,
      model: settings.model,
      thinking: settings.thinking,
      effort: settings.effort,
      idleTimeoutMs: this.idleTimeoutMs,
    });
    holder.process = process;
    this.register(process);
    return process;
  }

  private register(process: AgentProcess): void {
    const { sessionId } = process;
    getLogger().info(
      { event: "process_registered", sessionId, processId: process.id },
      `Process registered for session ${sessionId}`,
    );
    this.processes.set(sessionId, process);
    process.subscribe((event) => {
      // A released process's ending belongs to nobody.
      if (this.processes.get(sessionId) !== process) return;
      if (event.type === "terminated") {
        this.processes.delete(sessionId);
        getLogger().info(
          {
            event: "process_unregistered",
            sessionId,
            processId: process.id,
            durationMs: Date.now() - process.startedAt.getTime(),
            reason: event.reason,
          },
          `Process for session ${sessionId} ended: ${event.reason}`,
        );
      }
      this.onEvent(sessionId, event);
    });
  }

  /**
   * Terminate processes stuck in "in-turn" with no provider events for too
   * long: the CLI died without its event stream ending or throwing. When the
   * provider can report liveness, only a dead process is stopped — a live but
   * silent one is most likely in a long tool call.
   */
  private terminateStaleProcesses(): void {
    const now = Date.now();
    for (const process of this.processes.values()) {
      if (process.state.type !== "in-turn") continue;
      const staleThresholdMs = getStaleInTurnThresholdMs(process.provider);
      const silentMs = now - process.lastMessageTime.getTime();
      if (silentMs < staleThresholdMs) continue;
      const alive = process.isProcessAlive;
      if (alive === true) continue;
      getLogger().warn(
        {
          event: alive === undefined ? "stale_process_detected" : "stale_process_dead",
          sessionId: process.sessionId,
          processId: process.id,
          provider: process.provider,
          silentMs,
          staleThresholdMs,
        },
        `Terminating ${alive === undefined ? "stale" : "dead"} process for ${process.sessionId} (no events for ${Math.round(silentMs / 1000)}s)`,
      );
      process.stop(`stale: no provider events for ${Math.round(silentMs / 1000)}s`);
    }
  }
}
