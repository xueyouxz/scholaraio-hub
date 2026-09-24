import { randomUUID } from "node:crypto";
import type { PermissionRules, ProviderName, ThinkingConfig } from "@scholaraio-hub/shared";
import type { AgentEvent } from "../agent/events.js";
import { getLogger } from "../logging/logger.js";
import { type MessageQueue, describeAttachments } from "../sdk/messageQueue.js";
import { decidePermission } from "../sdk/providers/permission-policy.js";
import {
  type ResolvedSessionControls,
  resolveSessionControls,
} from "../sdk/providers/session-capabilities.js";
import type { AgentSession } from "../sdk/providers/types.js";
import type { PermissionMode, ToolApprovalResult, UserMessage } from "../sdk/types.js";
import { ApprovalQueue } from "./ApprovalQueue.js";
import { matchPermissionRules } from "./permissionRules.js";
import type { InputRequest, ProcessEvent, ProcessOptions, ProcessState } from "./types.js";
import { DEFAULT_IDLE_TIMEOUT_MS } from "./types.js";

type Listener = (event: ProcessEvent) => void;

export interface ProcessConstructorOptions extends ProcessOptions {
  /** Where messages for the provider go after the first one */
  queue: MessageQueue;
  /** Abort function from the provider session */
  abortFn?: () => void;
  /** Check if underlying CLI process is still alive (for stale detection) */
  isProcessAlive?: () => boolean;
  /**
   * Session controls with their capability descriptor, from
   * `resolveSessionControls()`. Absent for processes that are not backed by a
   * provider session (tests that drive a bare iterator).
   */
  controls?: ResolvedSessionControls;
}

export class Process {
  readonly id: string;
  private _sessionId: string;
  readonly projectPath: string;
  /** Application session that owns this process, when one does. */
  readonly ownerId?: string;
  readonly startedAt: Date;
  readonly provider: ProviderName;

  private readonly messageQueue: MessageQueue;
  private abortFn: (() => void) | null;
  private _state: ProcessState = { type: "in-turn" };
  private listeners: Set<Listener> = new Set();
  private idleTimer: NodeJS.Timeout | null = null;
  private idleTimeoutMs: number;
  private iteratorDone = false;

  /** Set synchronously when transport/spawn fails to prevent race with queueMessage */
  private transportFailed = false;

  /** Tool approvals waiting on the user, in the order they were asked. */
  private readonly approvals = new ApprovalQueue({
    onShow: (request) => this.setState({ type: "waiting-input", request }),
    onDrained: () => this.setState({ type: "in-turn" }),
  });

  /** Current permission mode for tool approvals */
  private _permissionMode: PermissionMode = "default";

  /** Permission rules for tool filtering (deny/allow patterns from API caller) */
  private _permissions: PermissionRules | undefined;

  /** Thinking configuration (undefined = thinking disabled) */
  private _thinking: ThinkingConfig | undefined;
  /** Effort level for response quality */
  private _effort: string | undefined;

  /** Session controls plus the capability descriptor that says which are real. */
  private readonly controls: ResolvedSessionControls;

  /** Resolvers waiting for the real session ID */
  private sessionIdResolvers: Array<(id: string) => void> = [];
  private sessionIdResolved = false;

  /** Timestamp of last SDK message received (for staleness detection) */
  private _lastMessageTime: Date;

  /** Check if underlying CLI process is still alive (undefined = not available, fall back to time heuristic) */
  private _isProcessAlive: (() => boolean) | null;

  /** Promise that resolves when the process fully terminates (CLI exits) */
  private _exitPromise: Promise<void>;
  private _exitResolve: (() => void) | null = null;

  constructor(
    private agentEvents: AsyncIterator<AgentEvent>,
    options: ProcessConstructorOptions,
  ) {
    this.id = randomUUID();
    this._sessionId = options.sessionId;
    this.projectPath = options.projectPath;
    this.ownerId = options.ownerId;
    this.startedAt = new Date();
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

    this.messageQueue = options.queue;
    this.abortFn = options.abortFn ?? null;
    this._permissionMode = options.permissionMode ?? "default";
    this._permissions = options.permissions;
    this.provider = options.provider;
    this._thinking = options.thinking;
    this._effort = options.effort;
    this.controls = options.controls ?? resolveSessionControls({} as AgentSession);
    this._isProcessAlive = options.isProcessAlive ?? null;
    this._lastMessageTime = new Date();

    // Exit promise resolves when the CLI process fully terminates
    this._exitPromise = new Promise((resolve) => {
      this._exitResolve = resolve;
    });

    // Start consuming the provider's event stream
    this.processMessages();
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get state(): ProcessState {
    return this._state;
  }

  /** When the last SDK message was received (for staleness detection) */
  get lastMessageTime(): Date {
    return this._lastMessageTime;
  }

  /**
   * Check if the underlying CLI process is still alive.
   * Returns true if alive, false if dead, undefined if liveness check is unavailable.
   */
  get isProcessAlive(): boolean | undefined {
    return this._isProcessAlive?.();
  }

  get permissionMode(): PermissionMode {
    return this._permissionMode;
  }

  /**
   * Thinking configuration for this process.
   * undefined means thinking is disabled.
   */
  get thinking(): ThinkingConfig | undefined {
    return this._thinking;
  }

  /**
   * Effort level for this process.
   */
  get effort(): string | undefined {
    return this._effort;
  }

  /**
   * Update thinking config and effort after a dynamic change.
   */
  updateThinkingConfig(thinking?: ThinkingConfig, effort?: string): void {
    this._thinking = thinking;
    this._effort = effort;
  }

  /**
   * Whether this process supports dynamic thinking mode changes.
   * Only Claude SDK 0.2.7+ supports this.
   */
  get supportsThinkingModeChange(): boolean {
    return this.controls.capabilities.thinkingTokens;
  }

  /**
   * Interrupt the current turn gracefully without killing the process.
   * The query will stop processing the current turn and return control.
   * Only supported by Claude SDK 0.2.7+.
   *
   * @returns true if the interrupt was triggered, false if not supported
   */
  async interrupt(): Promise<boolean> {
    if (!this.controls.capabilities.interrupt) {
      return false;
    }

    const log = getLogger();
    log.info(
      {
        event: "process_interrupt",
        sessionId: this._sessionId,
        processId: this.id,
        currentState: this._state.type,
      },
      `Interrupting process: ${this._sessionId}`,
    );

    await this.controls.interrupt();
    return true;
  }

  /**
   * Change thinking mode at runtime via the deprecated setMaxThinkingTokens API.
   * On Opus 4.6, 0 = disabled, any non-zero = adaptive.
   * Only supported by Claude SDK 0.2.7+.
   *
   * @param tokens - Non-zero to enable adaptive thinking, undefined/0 to disable
   * @returns true if the change was applied, false if not supported
   */
  async setMaxThinkingTokens(tokens: number | undefined): Promise<boolean> {
    if (!this.controls.capabilities.thinkingTokens) {
      return false;
    }

    const log = getLogger();
    log.info(
      {
        event: "thinking_mode_change",
        sessionId: this._sessionId,
        processId: this.id,
        oldThinking: this._thinking?.type,
        newThinking: tokens ? "adaptive" : "disabled",
      },
      `Changing thinking mode: ${this._thinking?.type ?? "disabled"} → ${tokens ? "adaptive" : "disabled"}`,
    );

    // SDK uses null to disable, we use undefined for consistency with our types
    await this.controls.setMaxThinkingTokens(tokens ?? null);
    return true;
  }

  /**
   * Whether the process has been terminated (either manually or due to error).
   * A terminated process cannot accept new messages.
   */
  get isTerminated(): boolean {
    return this._state.type === "terminated";
  }

  /**
   * Get the termination reason if the process was terminated.
   */
  get terminationReason(): string | null {
    if (this._state.type === "terminated") {
      return this._state.reason;
    }
    return null;
  }

  /** Update the permission mode for this process's future tool approvals. */
  setPermissionMode(mode: PermissionMode): void {
    this._permissionMode = mode;
  }

  /**
   * Mark the process as terminated due to an error or external termination.
   * Emits a terminated event and cleans up resources.
   */
  private markTerminated(reason: string, error?: Error): void {
    if (this._state.type === "terminated") {
      return; // Already terminated
    }

    const log = getLogger();
    const durationMs = Date.now() - this.startedAt.getTime();
    const pendingApprovalCount = this.approvals.size;

    log.warn(
      {
        event: "process_terminated",
        sessionId: this._sessionId,
        processId: this.id,
        reason,
        errorMessage: error?.message,
        errorStack: error?.stack,
        durationMs,
        pendingApprovalCount,
        previousState: this._state.type,
      },
      `Process terminated: ${this._sessionId} - ${reason}`,
    );

    this.clearIdleTimer();
    this.iteratorDone = true;

    this.approvals.denyAll(`Process terminated: ${reason}`);

    this.setState({ type: "terminated", reason, error });
    this.emit({ type: "terminated", reason, error });
    this.emit({ type: "complete" });

    // Resolve exit promise so abort() callers can wait for full termination
    if (this._exitResolve) {
      this._exitResolve();
      this._exitResolve = null;
    }
  }

  /**
   * Wait for the real session ID from the SDK's init message.
   * Returns immediately if already received, or waits with a timeout.
   */
  waitForSessionId(timeoutMs = 5000): Promise<string> {
    if (this.sessionIdResolved) {
      return Promise.resolve(this._sessionId);
    }

    return new Promise((resolve) => {
      this.sessionIdResolvers.push(resolve);

      // Timeout fallback - resolve with current ID even if not updated
      setTimeout(() => {
        const index = this.sessionIdResolvers.indexOf(resolve);
        if (index >= 0) {
          this.sessionIdResolvers.splice(index, 1);
          resolve(this._sessionId);
        }
      }, timeoutMs);
    });
  }

  /**
   * Build user message content that matches what MessageQueue sends to the SDK.
   * This ensures SSE/history messages can be deduplicated against JSONL.
   */
  private buildUserMessageContent(message: UserMessage): string {
    return message.text + describeAttachments(message.attachments);
  }

  /**
   * Queue a message to be sent to the provider, or steer the running turn with
   * it when the provider can.
   *
   * @returns Object with success status and queue position or error
   */
  queueMessage(message: UserMessage): {
    success: boolean;
    position?: number;
    error?: string;
  } {
    // Check if process is terminated or transport failed
    if (this._state.type === "terminated") {
      return {
        success: false,
        error: `Process terminated: ${this._state.reason}`,
      };
    }

    // Check if transport failed (spawn error, etc.) - this flag is set synchronously
    // to prevent race conditions where queueMessage is called before markTerminated completes
    if (this.transportFailed) {
      return {
        success: false,
        error: "Process transport failed",
      };
    }

    // Create user message with UUID - this UUID will be used by both SSE and SDK
    const uuid = randomUUID();
    const messageWithUuid: UserMessage = { ...message, uuid };

    // The same text the provider receives, attachments included.
    const content = this.buildUserMessageContent(message);

    // If provider supports in-turn steering, prefer that over queue-after-turn behavior.
    if (this._state.type === "in-turn" && this.controls.capabilities.steer) {
      const steerMessage: UserMessage = {
        ...messageWithUuid,
        // Mirror MessageQueue's attachment expansion for steer payloads.
        text: content,
        attachments: undefined,
      };
      void this.controls
        .steer(steerMessage)
        .then((steered) => {
          if (!steered) {
            this.messageQueue.push(messageWithUuid);
          }
        })
        .catch((error) => {
          const log = getLogger();
          log.warn(
            {
              event: "process_steer_failed",
              sessionId: this._sessionId,
              processId: this.id,
              provider: this.provider,
              error: error instanceof Error ? error.message : String(error),
            },
            "Steer failed; falling back to queued message",
          );
          this.messageQueue.push(messageWithUuid);
        });
      return { success: true, position: 0 };
    }

    // Transition to running if we were idle
    if (this._state.type === "idle") {
      this.clearIdleTimer();
      this.setState({ type: "in-turn" });
    }
    // Pass message with UUID so SDK uses the same UUID we emitted via SSE
    const position = this.messageQueue.push(messageWithUuid);
    return { success: true, position };
  }

  /**
   * Handle a tool approval request from the provider.
   *
   * Session-specific allow/deny rules win, then the shared permission contract
   * in `sdk/providers/permission-policy.ts` decides; anything it does not
   * auto-approve is put to the user.
   */
  async handleToolApproval(
    toolName: string,
    input: unknown,
    options: { signal: AbortSignal; toolUseID?: string },
  ): Promise<ToolApprovalResult> {
    // Check if aborted
    if (options.signal.aborted) {
      return {
        behavior: "deny",
        message: "Operation aborted",
        interrupt: true,
      };
    }

    // Session allow/deny rules win over the mode.
    const permissionResult = matchPermissionRules(this._permissions, toolName, input);
    if (permissionResult) {
      return permissionResult;
    }

    if (decidePermission(this._permissionMode, toolName, input) === "allow") {
      return { behavior: "allow" };
    }

    // Default behavior: ask user for approval
    const request: InputRequest = {
      id: randomUUID(),
      sessionId: this._sessionId,
      type: "tool-approval",
      prompt: `Allow ${toolName}?`,
      toolName,
      toolInput: input,
      ...(options.toolUseID ? { toolCallId: options.toolUseID } : {}),
      timestamp: new Date().toISOString(),
    };

    return this.approvals.ask(request, options.signal);
  }

  /**
   * Respond to a pending input request (tool approval).
   * Called from the API when user approves/denies a tool.
   * For AskUserQuestion, answers can be passed to update the tool input.
   * For deny with feedback, the feedback message is passed to the SDK.
   */
  respondToInput(
    requestId: string,
    response: "approve" | "deny",
    answers?: Record<string, string>,
    feedback?: string,
  ): boolean {
    const pendingRequest = this.approvals.get(requestId);

    if (!pendingRequest) return false;

    // Build the result with optional updated input for AskUserQuestion.
    // If deny has feedback, use that as the message.
    const trimmedFeedback = feedback?.trim();
    const denyMessage = trimmedFeedback || "User denied permission";
    // If user just clicked "No" without feedback, set interrupt: true to stop retrying.
    // If user provided feedback, set interrupt: false so Claude can incorporate the guidance.
    const shouldInterrupt = response === "deny" && !trimmedFeedback;
    const result: ToolApprovalResult = {
      behavior: response === "approve" ? "allow" : "deny",
      message: response === "deny" ? denyMessage : undefined,
      interrupt: response === "deny" ? shouldInterrupt : undefined,
    };

    // If answers provided (AskUserQuestion), pass them as updatedInput
    if (answers && response === "approve") {
      const originalInput = pendingRequest.toolInput as {
        questions?: unknown[];
      };
      result.updatedInput = {
        ...originalInput,
        answers,
      };
    }

    // If EnterPlanMode is approved, switch to plan mode
    if (response === "approve" && pendingRequest.toolName === "EnterPlanMode") {
      this.setPermissionMode("plan");
    }

    // If ExitPlanMode is approved, switch back to default mode
    if (response === "approve" && pendingRequest.toolName === "ExitPlanMode") {
      this.setPermissionMode("default");
    }

    this.approvals.settle(requestId, result);

    // Codex app-server decline decisions do not currently include a rejection
    // reason in-protocol. Queue the feedback as a follow-up user message.
    if (response === "deny" && trimmedFeedback && this.provider === "codex") {
      const queued = this.queueMessage({
        text: `I denied that request. Instead: ${trimmedFeedback}`,
      });
      if (!queued.success) {
        getLogger().warn(
          {
            sessionId: this._sessionId,
            processId: this.id,
            error: queued.error,
          },
          "Failed to queue Codex deny feedback follow-up message",
        );
      }
    }

    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Terminate the process with a reason (e.g., staleness detection).
   * Unlike abort(), this records the reason for logging/debugging.
   * Also calls abortFn to kill the underlying CLI process, preventing
   * orphaned processes that continue running after the Hub stops tracking them.
   */
  terminate(reason: string): void {
    // Kill the underlying CLI process first (if available), so it doesn't
    // continue running as an orphan after we unregister from the Supervisor.
    if (this.abortFn) {
      this.abortFn();
    }
    this.markTerminated(reason);
  }

  async abort(): Promise<void> {
    this.clearIdleTimer();

    // Call the SDK's abort function if available
    if (this.abortFn) {
      this.abortFn();
    }

    // Wait for CLI process to fully exit (with timeout to avoid hanging)
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      });
      await Promise.race([this._exitPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }

    // Signal completion to subscribers (skip if already terminated —
    // markTerminated() already emitted "complete")
    if (this._state.type !== "terminated") {
      this.emit({ type: "complete" });
    }
    this.listeners.clear();
  }

  private async processMessages(): Promise<void> {
    try {
      while (!this.iteratorDone) {
        const result = await this.agentEvents.next();

        if (result.done) {
          this.iteratorDone = true;
          // Don't transition to idle if we're waiting for input
          if (this._state.type !== "waiting-input") {
            this.transitionToIdle();
          }
          break;
        }

        const event = result.value;
        this._lastMessageTime = new Date();

        if (event.type === "session.started") {
          this.adoptSessionId(event.sessionId);
        }

        this.emit({ type: "agent", event });

        if (event.type === "turn.completed") {
          this.transitionToIdle();
        }
      }
    } catch (error) {
      const err = error as Error;
      const log = getLogger();

      log.error(
        {
          event: "process_error",
          sessionId: this._sessionId,
          processId: this.id,
          errorMessage: err.message,
          errorStack: err.stack,
          currentState: this._state.type,
        },
        `Process error: ${this._sessionId} - ${err.message}`,
      );

      this.emit({ type: "error", error: err });

      // Detect process termination errors - set flag synchronously BEFORE markTerminated
      // to prevent race where queueMessage is called before state changes to terminated
      if (this.isProcessTerminationError(err)) {
        this.transportFailed = true;
        this.markTerminated("underlying process terminated", err);
        return;
      }

      // Don't transition to idle if we're waiting for input
      if (this._state.type !== "waiting-input") {
        this.transitionToIdle();
      }
    } finally {
      // Resolve exit promise on both normal completion and non-terminating errors
      // so abort() doesn't hang waiting for it. (markTerminated already resolves
      // it for termination errors, and guards against double-resolve.)
      if (this._exitResolve) {
        this._exitResolve();
        this._exitResolve = null;
      }
    }
  }

  /** Take the provider's native session id and wake anyone waiting for it. */
  private adoptSessionId(sessionId: string): void {
    const previous = this._sessionId;
    this._sessionId = sessionId;
    this.sessionIdResolved = true;

    getLogger().info(
      {
        event: "session_id_received",
        sessionId,
        previousTempId: previous,
        processId: this.id,
      },
      `Session ID received from provider: ${sessionId}`,
    );

    // The supervisor re-keys its session map on this event.
    if (previous !== sessionId) {
      this.emit({ type: "session-id-changed", oldSessionId: previous, newSessionId: sessionId });
    }

    for (const resolve of this.sessionIdResolvers) resolve(sessionId);
    this.sessionIdResolvers = [];
  }

  /**
   * Check if an error indicates the underlying Claude process was terminated.
   */
  private isProcessTerminationError(error: Error): boolean {
    const message = error.message || "";
    return (
      message.includes("ProcessTransport is not ready") ||
      message.includes("not ready for writing") ||
      message.includes("process exited") ||
      message.includes("SIGTERM") ||
      message.includes("SIGKILL") ||
      // SDK wraps spawn errors as "Failed to spawn Claude Code process: spawn <cmd> ENOENT"
      // where <cmd> varies (e.g., "node", "claude"), so check for ENOENT broadly
      message.includes("ENOENT")
    );
  }

  private transitionToIdle(): void {
    this.clearIdleTimer();
    this.setState({ type: "idle", since: new Date() });
    this.startIdleTimer();
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;

      // State may have changed while the timer was pending.
      if (this._state.type !== "idle") {
        return;
      }

      // The application keeps its native ID for resume; an idle CLI worker
      // need not live forever just to keep the session visible.
      this.terminate("Idle timeout");
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private setState(state: ProcessState): void {
    this._state = state;
    this.emit({ type: "state-change", state });
  }

  private emit(event: ProcessEvent): void {
    if (event.type === "state-change") {
      getLogger().debug(
        {
          component: "process",
          sessionId: this._sessionId,
          eventType: "state-change",
          listenerCount: this.listeners.size,
          newState: event.state.type,
        },
        `Emitting state-change to ${this.listeners.size} listeners`,
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // One failing subscriber must not starve the others of the event.
        getLogger().error(
          { sessionId: this._sessionId, eventType: event.type, error },
          "Process event listener failed",
        );
      }
    }
  }
}
