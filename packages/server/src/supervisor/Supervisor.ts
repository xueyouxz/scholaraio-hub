import { randomUUID } from "node:crypto";
import type { ProviderName, ThinkingConfig } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import type { ProviderRegistry } from "../providers/ProviderRegistry.js";
import type { PermissionMode, UserMessage } from "../providers/types.js";
import { AgentProcess, type ProcessEvent } from "./AgentProcess.js";

/** How often to check for stale processes (60 seconds) */
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

/** Default in-turn stale threshold for providers with frequent heartbeat/tool events. */
const DEFAULT_STALE_IN_TURN_THRESHOLD_MS = 5 * 60 * 1000;
/** Codex sessions can be silent for long periods during backend retries/reconnects. */
const CODEX_STALE_IN_TURN_THRESHOLD_MS = 60 * 60 * 1000;
/**
 * How long a process may wait on an approval or question nobody answers. The
 * session keeps its native id, so the next message resumes where it stopped.
 */
const DEFAULT_UNANSWERED_INPUT_TIMEOUT_MS = 30 * 60 * 1000;

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
  /** The providers this server runs; a request names one or gets the default. */
  providers: ProviderRegistry;
  idleTimeoutMs?: number;
  /** How long a pending approval or question may go unanswered before the process stops. */
  unansweredInputTimeoutMs?: number;
}

/**
 * Every event of every live process, with the session it serves. A process
 * that was released (replaced or deleted) reports nothing more.
 */
export type SupervisorListener = (sessionId: string, event: ProcessEvent) => void;

/**
 * Owns the provider processes this server runs, one per session and keyed by
 * our own session id. It keeps each live process matching what the session
 * asks for — provider, native conversation, model, thinking, effort — and
 * reaps processes that died without saying so.
 */
export class Supervisor {
  private readonly processes = new Map<string, AgentProcess>();
  private readonly providers: ProviderRegistry;
  private readonly idleTimeoutMs?: number;
  private readonly unansweredInputTimeoutMs: number;
  private readonly listeners = new Set<SupervisorListener>();
  private readonly staleCheckTimer: ReturnType<typeof setInterval>;
  /** The send in progress for each session; the next one waits for it. */
  private readonly sending = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(options: SupervisorOptions) {
    this.providers = options.providers;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.unansweredInputTimeoutMs =
      options.unansweredInputTimeoutMs ?? DEFAULT_UNANSWERED_INPUT_TIMEOUT_MS;
    this.staleCheckTimer = setInterval(
      () => this.terminateStaleProcesses(),
      STALE_CHECK_INTERVAL_MS,
    );
    this.staleCheckTimer.unref(); // Don't keep process alive for cleanup
  }

  /** Hear every live process's events until the returned unsubscribe, or `close`. */
  subscribe(listener: SupervisorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The session's live process, if it has one. */
  get(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId);
  }

  /**
   * Send a message to a session: to its live process when that one still
   * matches the request, otherwise to a new process (resuming the native
   * conversation when there is one). Sends to one session run one at a time,
   * so two never launch a process each. Resolves with the process that took
   * the message.
   */
  send(request: SessionMessageRequest): Promise<AgentProcess> {
    const { sessionId } = request;
    const previous = this.sending.get(sessionId) ?? Promise.resolve();
    const sent = previous.then(
      () => this.deliver(request),
      () => this.deliver(request),
    );
    this.sending.set(sessionId, sent);
    const forget = () => {
      if (this.sending.get(sessionId) === sent) this.sending.delete(sessionId);
    };
    sent.then(forget, forget);
    return sent;
  }

  private async deliver(request: SessionMessageRequest): Promise<AgentProcess> {
    if (this.closed) throw new Error("The server is shutting down");
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
   * it is replacing it or removing the session. With `expected`, only that
   * process: one that has since been replaced belongs to someone else. No-op
   * when there is none.
   */
  release(sessionId: string, reason: string, expected?: AgentProcess): void {
    const process = this.processes.get(sessionId);
    if (!process || (expected && process !== expected)) return;
    this.processes.delete(sessionId);
    void process.stop(reason);
  }

  /** Stop every process and wait for their CLIs to exit; no process starts afterwards. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.staleCheckTimer);
    this.listeners.clear();
    const processes = [...this.processes.values()];
    this.processes.clear();
    await Promise.all(processes.map((process) => process.stop("Server closing")));
  }

  /**
   * Bring a live process to what the request needs. Thinking alone can switch
   * in place; any other difference releases the process and returns false.
   */
  private async adopt(process: AgentProcess, request: SessionMessageRequest): Promise<boolean> {
    const reason = await this.mismatch(process, request.nativeSessionId, request.settings ?? {});
    if (!reason) return true;
    loggerFor("supervisor").info(
      { event: "process_replaced", sessionId: request.sessionId, processId: process.id, reason },
      `Replacing process for ${request.sessionId}: ${reason}`,
    );
    this.release(request.sessionId, reason);
    return false;
  }

  /** Why the live process cannot serve the request, or undefined when it can. */
  private async mismatch(
    process: AgentProcess,
    nativeSessionId: string | undefined,
    settings: LaunchSettings,
  ): Promise<string | undefined> {
    if (process.isTerminated) return "Process already ended";
    if (this.providers.get(settings.providerName).name !== process.provider)
      return "Provider changed";
    if (nativeSessionId !== process.nativeSessionId)
      return "Session continues a different conversation";
    if (settings.model !== process.model) return "Model changed";
    if (settings.effort !== process.effort) return "Effort changed";
    // Thinking alone can switch in place, when the provider allows it.
    if (
      process.thinking?.type !== settings.thinking?.type &&
      !(await process.changeThinking(settings.thinking))
    )
      return "Thinking changed";
    return undefined;
  }

  private async launch(request: SessionMessageRequest): Promise<AgentProcess> {
    const { sessionId, nativeSessionId, projectPath, message } = request;
    const settings = request.settings ?? {};
    const provider = this.providers.get(settings.providerName);
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
    if (this.closed) {
      await process.stop("Server closing");
      throw new Error("The server is shutting down");
    }
    this.register(process);
    return process;
  }

  private register(process: AgentProcess): void {
    const { sessionId } = process;
    // Never two processes for one session: the one being replaced stops.
    this.release(sessionId, "Superseded by a new process");
    loggerFor("supervisor").info(
      { event: "process_registered", sessionId, processId: process.id },
      `Process registered for session ${sessionId}`,
    );
    this.processes.set(sessionId, process);
    process.subscribe((event) => {
      // A released process's ending belongs to nobody.
      if (this.processes.get(sessionId) !== process) return;
      if (event.type === "terminated") {
        this.processes.delete(sessionId);
        loggerFor("supervisor").info(
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
      for (const listener of this.listeners) {
        try {
          listener(sessionId, event);
        } catch (error) {
          // One failing subscriber must not starve the others of the event.
          loggerFor("supervisor").error(
            { err: error, sessionId, eventType: event.type },
            "Supervisor listener failed",
          );
        }
      }
    });
  }

  /**
   * Terminate processes stuck in "in-turn" with no provider events for too
   * long: the CLI died without its event stream ending or throwing. When the
   * provider can report liveness, only a dead process is stopped — a live but
   * silent one is most likely in a long tool call. A process waiting on input
   * nobody answers is stopped too, so a closed tab does not keep its CLI alive.
   */
  private terminateStaleProcesses(): void {
    const now = Date.now();
    for (const process of this.processes.values()) {
      if (process.state.type === "waiting-input") {
        const waitingMs = now - Date.parse(process.state.request.timestamp);
        if (waitingMs < this.unansweredInputTimeoutMs) continue;
        loggerFor("supervisor").warn(
          {
            event: "input_unanswered",
            sessionId: process.sessionId,
            processId: process.id,
            waitingMs,
          },
          `Stopping process for ${process.sessionId}: input unanswered`,
        );
        const minutes = Math.round(waitingMs / 60_000);
        void process.stop(
          `input unanswered for ${minutes} min`,
          new Error(
            `Approval timed out after ${minutes} minutes. This turn was stopped; send a new message to continue.`,
          ),
        );
        continue;
      }
      if (process.state.type !== "in-turn") continue;
      const staleThresholdMs = getStaleInTurnThresholdMs(process.provider);
      const silentMs = now - process.lastMessageTime.getTime();
      if (silentMs < staleThresholdMs) continue;
      const alive = process.isProcessAlive;
      if (alive === true) continue;
      loggerFor("supervisor").warn(
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
      void process.stop(`stale: no provider events for ${Math.round(silentMs / 1000)}s`);
    }
  }
}
