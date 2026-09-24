import { randomUUID } from "node:crypto";
import type { ProviderName } from "@scholaraio-hub/shared";
import type { AgentEvent } from "../agent/events.js";
import { getLogger } from "../logging/logger.js";
import { getProvider } from "../sdk/providers/index.js";
import { resolveSessionControls } from "../sdk/providers/session-capabilities.js";
import type { AgentProvider } from "../sdk/providers/types.js";
import type { PermissionMode, UserMessage } from "../sdk/types.js";
import { Process } from "./Process.js";
import type { ModelSettings } from "./types.js";

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

/** Ask for a new session, sending the first message with it. */
export interface StartSessionRequest {
  projectPath: string;
  /** Our own session id, so its owner can find this process again. */
  ownerId?: string;
  message: UserMessage;
  permissionMode?: PermissionMode;
  modelSettings?: ModelSettings;
}

/** Ask to continue a session the provider already knows about. */
export interface ResumeSessionRequest extends StartSessionRequest {
  sessionId: string;
}

/** Every event a provider reports, for cross-session telemetry (e.g. rate limits). */
export type OnProviderEventCallback = (provider: ProviderName, event: AgentEvent) => void;

export interface SupervisorOptions {
  onProcessCreated?: (process: Process) => void;
  /** Agent provider used when a request does not name one */
  provider: AgentProvider;
  idleTimeoutMs?: number;
  /** Default permission mode for new sessions */
  defaultPermissionMode?: PermissionMode;
  /** Callback for provider-level telemetry carried in SDK message streams */
  onProviderEvent?: OnProviderEventCallback;
}

/**
 * Owns the provider processes this server runs: starts or resumes one per
 * session, finds a live one again by its native session id, and reaps processes
 * that died without saying so.
 */
export class Supervisor {
  private readonly onProcessCreated?: (process: Process) => void;
  private readonly processes = new Map<string, Process>();
  /** Native session id (the temporary one too, until the provider names it) → process id */
  private readonly sessionToProcess = new Map<string, string>();
  private readonly provider: AgentProvider;
  private readonly idleTimeoutMs?: number;
  private readonly defaultPermissionMode: PermissionMode;
  private readonly onProviderEvent?: OnProviderEventCallback;
  private readonly staleCheckTimer: ReturnType<typeof setInterval>;

  constructor(options: SupervisorOptions) {
    this.onProcessCreated = options.onProcessCreated;
    this.provider = options.provider;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.defaultPermissionMode = options.defaultPermissionMode ?? "default";
    this.onProviderEvent = options.onProviderEvent;
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

  async close(): Promise<void> {
    clearInterval(this.staleCheckTimer);
    await Promise.all([...this.processes.values()].map((process) => process.abort()));
  }

  startSession(request: StartSessionRequest): Promise<Process> {
    return this.launch(request);
  }

  /**
   * Send a message to a session: to its live process when there is one,
   * otherwise to a new process that resumes it.
   */
  async resumeSession(request: ResumeSessionRequest): Promise<Process> {
    const { sessionId, message, permissionMode, modelSettings } = request;
    const existing = this.liveProcessFor(sessionId);
    if (existing && (await this.adoptSettings(existing, modelSettings))) {
      if (permissionMode) existing.setPermissionMode(permissionMode);
      if (existing.queueMessage(message).success) return existing;
      // Queueing failed: the process is gone underneath us, so start fresh.
      this.unregisterProcess(existing);
    }
    return this.launch(request, sessionId);
  }

  private liveProcessFor(sessionId: string): Process | undefined {
    const processId = this.sessionToProcess.get(sessionId);
    const process = processId ? this.processes.get(processId) : undefined;
    if (!process) return undefined;
    if (!process.isTerminated) return process;
    this.unregisterProcess(process);
    return undefined;
  }

  /**
   * Bring a live process to the requested thinking/effort settings. Returns false
   * when that took a restart, after which the caller must start a new process.
   */
  private async adoptSettings(process: Process, settings?: ModelSettings): Promise<boolean> {
    const thinkingChanged = process.thinking?.type !== (settings?.thinking?.type ?? undefined);
    const effortChanged = process.effort !== settings?.effort;
    if (!thinkingChanged && !effortChanged) return true;
    const log = getLogger();
    if (thinkingChanged && !effortChanged && process.supportsThinkingModeChange) {
      // Toggle adaptive/disabled dynamically via deprecated API
      const tokens = settings?.thinking?.type === "disabled" ? undefined : 1;
      if (await process.setMaxThinkingTokens(tokens)) {
        process.updateThinkingConfig(settings?.thinking, settings?.effort);
      } else {
        log.warn(
          { event: "thinking_mode_change_failed", sessionId: process.sessionId },
          "Failed to change thinking mode dynamically",
        );
      }
      return true;
    }
    log.info(
      {
        event: "thinking_mode_changed_restart",
        sessionId: process.sessionId,
        processId: process.id,
        oldThinking: process.thinking?.type,
        oldEffort: process.effort,
        newThinking: settings?.thinking?.type,
        newEffort: settings?.effort,
      },
      "Thinking/effort changed, restarting process",
    );
    await process.abort();
    this.unregisterProcess(process);
    return false;
  }

  /** Start a provider session and register the process that runs it. */
  private async launch(request: StartSessionRequest, resumeSessionId?: string): Promise<Process> {
    const { projectPath, ownerId, message, permissionMode, modelSettings } = request;
    const provider = this.providerFor(modelSettings?.providerName);
    // The approval callback is handed over before the process exists.
    const holder: { process?: Process } = {};
    const effectiveMode = permissionMode ?? this.defaultPermissionMode;
    // Generate UUID for the initial message so SDK and SSE use the same ID.
    const initialMessage: UserMessage = { ...message, uuid: randomUUID() };

    const session = await provider.startSession({
      cwd: projectPath,
      initialMessage,
      resumeSessionId,
      permissionMode: effectiveMode,
      model: modelSettings?.model,
      thinking: modelSettings?.thinking,
      effort: modelSettings?.effort,
      globalInstructions: modelSettings?.globalInstructions,
      onToolApproval: async (toolName, input, opts) => {
        if (!holder.process) return { behavior: "deny", message: "Process not ready" };
        return holder.process.handleToolApproval(toolName, input, opts);
      },
    });

    const process = new Process(session.events, {
      projectPath,
      ownerId,
      sessionId: resumeSessionId ?? randomUUID(),
      idleTimeoutMs: this.idleTimeoutMs,
      queue: session.queue,
      abortFn: session.abort,
      isProcessAlive: session.isProcessAlive,
      controls: resolveSessionControls(session),
      permissionMode: effectiveMode,
      provider: provider.name,
      thinking: modelSettings?.thinking,
      effort: modelSettings?.effort,
      permissions: modelSettings?.permissions,
    });
    holder.process = process;
    this.onProcessCreated?.(process);

    // A new session is known by the provider's id; wait for it before registering.
    if (!resumeSessionId) await process.waitForSessionId();
    this.registerProcess(process);
    return process;
  }

  private registerProcess(process: Process): void {
    getLogger().info(
      {
        event: "session_registered",
        sessionId: process.sessionId,
        processId: process.id,
        projectPath: process.projectPath,
        permissionMode: process.permissionMode,
      },
      `Session registered: ${process.sessionId} (process: ${process.id})`,
    );

    this.processes.set(process.id, process);
    this.sessionToProcess.set(process.sessionId, process.id);

    process.subscribe((event) => {
      if (event.type === "complete") {
        this.unregisterProcess(process);
      } else if (event.type === "agent") {
        this.onProviderEvent?.(process.provider, event.event);
      } else if (event.type === "session-id-changed") {
        // Keep the temporary id too: a caller may still hold it.
        getLogger().info(
          {
            event: "session_id_mapping_updated",
            oldSessionId: event.oldSessionId,
            newSessionId: event.newSessionId,
            processId: process.id,
          },
          `Session ID mapping updated: ${event.oldSessionId} → ${event.newSessionId}`,
        );
        this.sessionToProcess.set(event.newSessionId, process.id);
      }
    });
  }

  private unregisterProcess(process: Process): void {
    const durationMs = Date.now() - process.startedAt.getTime();
    getLogger().info(
      {
        event: "session_unregistered",
        sessionId: process.sessionId,
        processId: process.id,
        durationMs,
        finalState: process.state.type,
        terminationReason: process.terminationReason,
      },
      `Session unregistered: ${process.sessionId} after ${durationMs}ms (reason: ${process.terminationReason ?? process.state.type})`,
    );

    this.processes.delete(process.id);
    // Both the temporary and the native session id point here.
    for (const [sessionId, processId] of this.sessionToProcess) {
      if (processId === process.id) this.sessionToProcess.delete(sessionId);
    }
  }

  /**
   * Terminate processes stuck in "in-turn" with no SDK messages for too long.
   * This catches phantom processes where the underlying CLI died without the
   * SDK iterator returning done or throwing.
   *
   * When process liveness checking is available (via spawn wrapper), it tells
   * "process died silently" from "process is busy with a long tool call"; only
   * dead processes are terminated.
   */
  private terminateStaleProcesses(): void {
    const now = Date.now();

    for (const process of this.processes.values()) {
      if (process.state.type !== "in-turn") continue;

      const staleThresholdMs = getStaleInTurnThresholdMs(process.provider);
      const silentMs = now - process.lastMessageTime.getTime();
      if (silentMs < staleThresholdMs) continue;

      // Alive but silent: most likely a long tool call (e.g. waiting on CI).
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
          livenessAvailable: alive !== undefined,
        },
        `Terminating ${alive === undefined ? "stale" : "dead"} process: ${process.sessionId} (no messages for ${Math.round(silentMs / 1000)}s)`,
      );
      process.terminate(`stale: no SDK messages for ${Math.round(silentMs / 1000)}s`);
    }
  }
}
