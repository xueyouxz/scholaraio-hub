import { randomUUID } from "node:crypto";
import type { ProviderName, ThinkingConfig } from "@scholaraio-hub/shared";
import type { InputRequest } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import type { AgentSession } from "../providers/types.js";
import type { PermissionMode, ToolApprovalResult, UserMessage } from "../providers/types.js";
import { ApprovalQueue } from "./ApprovalQueue.js";
import { decidePermission } from "./permission-policy.js";
import type { ProcessEvent, ProcessState } from "./types.js";

type Listener = (event: ProcessEvent) => void;

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface AgentProcessOptions {
  /** Our session id — the canonical one. A process serves exactly one session. */
  sessionId: string;
  /** The provider's id of the conversation being resumed; a new one reports its own. */
  nativeSessionId?: string;
  projectPath: string;
  provider: ProviderName;
  permissionMode?: PermissionMode;
  /** The model asked for at launch; undefined is the provider's default. */
  model?: string;
  /** Thinking configuration (undefined = thinking disabled) */
  thinking?: ThinkingConfig;
  /** Effort level for response quality (undefined = provider default) */
  effort?: string;
  idleTimeoutMs?: number;
}

/**
 * One provider worker: it drives an AgentSession, relays its events, puts tool
 * approvals to the user, and ends exactly once — when stopped, when idle too
 * long, or when the provider's event stream ends or fails.
 */
export class AgentProcess {
  readonly id = randomUUID();
  readonly sessionId: string;
  readonly projectPath: string;
  readonly provider: ProviderName;
  readonly model: string | undefined;
  readonly startedAt = new Date();

  private _nativeSessionId: string | undefined;
  private _resolvedModel: string | undefined;
  private _state: ProcessState = { type: "in-turn" };
  private _permissionMode: PermissionMode;
  private _thinking: ThinkingConfig | undefined;
  private _effort: string | undefined;
  private _lastMessageTime = new Date();
  private readonly listeners = new Set<Listener>();
  /** Settles once the session was aborted and its CLI has exited. */
  private exited: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleTimeoutMs: number;

  /** Tool approvals waiting on the user, in the order they were asked. */
  private readonly approvals = new ApprovalQueue({
    // Stamped when shown: a request that waited behind another has only been
    // unanswered since then.
    onShow: (request) =>
      this.setState({
        type: "waiting-input",
        request: { ...request, timestamp: new Date().toISOString() },
      }),
    onDrained: () => this.setState({ type: "in-turn" }),
  });

  constructor(
    private readonly session: AgentSession,
    options: AgentProcessOptions,
  ) {
    this.sessionId = options.sessionId;
    this._nativeSessionId = options.nativeSessionId;
    this.projectPath = options.projectPath;
    this.provider = options.provider;
    this.model = options.model;
    this._permissionMode = options.permissionMode ?? "default";
    this._thinking = options.thinking;
    this._effort = options.effort;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    // The loop awaits before its first event, so subscribers attached right
    // after construction see everything.
    void this.consume();
  }

  /** The provider's id of this conversation, once it has named one. */
  get nativeSessionId(): string | undefined {
    return this._nativeSessionId;
  }

  /** The concrete model the provider reported serving, when it has. */
  get resolvedModel(): string | undefined {
    return this._resolvedModel;
  }

  get state(): ProcessState {
    return this._state;
  }

  get isTerminated(): boolean {
    return this._state.type === "terminated";
  }

  get terminationReason(): string | null {
    return this._state.type === "terminated" ? this._state.reason : null;
  }

  /** When the provider last sent an event (for staleness detection). */
  get lastMessageTime(): Date {
    return this._lastMessageTime;
  }

  /** True if alive, false if dead, undefined when the provider cannot tell. */
  get isProcessAlive(): boolean | undefined {
    return this.session.isProcessAlive?.();
  }

  get permissionMode(): PermissionMode {
    return this._permissionMode;
  }

  /**
   * Update the permission mode for this process's future tool approvals, and
   * the provider's own side of it (its sandbox, its prompt) where it has one.
   */
  setPermissionMode(mode: PermissionMode): void {
    if (mode === this._permissionMode) return;
    this._permissionMode = mode;
    this.session.setPermissionMode?.(mode);
  }

  get thinking(): ThinkingConfig | undefined {
    return this._thinking;
  }

  get effort(): string | undefined {
    return this._effort;
  }

  /**
   * Switch thinking on (non-zero) or off (undefined/0) in place, keeping the
   * recorded config in step. False when the provider cannot.
   */
  async changeThinking(thinking: ThinkingConfig | undefined): Promise<boolean> {
    if (!this.session.setThinking) return false;
    loggerFor("agent-process").info(
      {
        event: "thinking_mode_change",
        sessionId: this.sessionId,
        processId: this.id,
        oldThinking: this._thinking?.type,
        newThinking: thinking?.type,
      },
      "Changing thinking mode in place",
    );
    await this.session.setThinking(thinking);
    this._thinking = thinking;
    return true;
  }

  /**
   * Stop the current turn without ending the process. False when the provider
   * cannot interrupt; the caller then has to stop the process instead. Any
   * approval of the stopped turn is denied: not every provider aborts it.
   */
  async interrupt(): Promise<boolean> {
    if (!this.session.interrupt) return false;
    loggerFor("agent-process").info(
      { event: "process_interrupt", sessionId: this.sessionId, processId: this.id },
      `Interrupting process: ${this.sessionId}`,
    );
    await this.session.interrupt();
    this.approvals.denyAll("Operation interrupted");
    if (this._state.type === "waiting-input") this.setState({ type: "in-turn" });
    return true;
  }

  /** Hand a message to the provider for its next turn. Fails only once the process ended. */
  queueMessage(message: UserMessage): { success: boolean; error?: string } {
    if (this._state.type === "terminated") {
      return { success: false, error: `Process terminated: ${this._state.reason}` };
    }
    if (this._state.type === "idle") this.setState({ type: "in-turn" });
    // The same UUID reaches the provider and our own record of the message.
    this.session.queue.push({ ...message, uuid: randomUUID() });
    return { success: true };
  }

  /**
   * Handle a tool approval request from the provider: the shared permission
   * contract in `permission-policy.ts` decides, and anything it
   * does not auto-approve is put to the user.
   */
  async handleToolApproval(
    toolName: string,
    input: unknown,
    options: { signal: AbortSignal; toolUseID?: string },
  ): Promise<ToolApprovalResult> {
    if (options.signal.aborted) {
      return { behavior: "deny", message: "Operation aborted", interrupt: true };
    }
    if (decidePermission(this._permissionMode, toolName, input) === "allow") {
      return { behavior: "allow" };
    }
    const request: InputRequest = {
      id: randomUUID(),
      sessionId: this.sessionId,
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
   * Answer a pending input request. For AskUserQuestion, `answers` become the
   * tool's updated input. Returns the request it answered, or undefined when
   * no such request is waiting. What the answer means for the session (a mode
   * switch, say) is the session's business, not the process's.
   */
  respondToInput(
    requestId: string,
    response: "approve" | "deny",
    answers?: Record<string, string>,
  ): InputRequest | undefined {
    const request = this.approvals.get(requestId);
    if (!request) return undefined;
    // A plain "no" stops the turn rather than letting the agent retry.
    const result: ToolApprovalResult =
      response === "approve"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "User denied permission", interrupt: true };
    if (answers && response === "approve") {
      result.updatedInput = { ...(request.toolInput as object), answers };
    }
    this.approvals.settle(requestId, result);
    return request;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * End the process: kill the provider's CLI and report the ending once. Its
   * event stream winds down on its own; nothing it says afterwards is relayed.
   * `error` tells the session why, when the user should know. Safe to call more
   * than once; what it returns settles once the CLI has exited, as far as the
   * provider can tell.
   */
  stop(reason: string, error?: Error): Promise<void> {
    if (this.isTerminated) return this.exited;
    this.markTerminated(reason, error);
    this.listeners.clear();
    return this.exited;
  }

  private async consume(): Promise<void> {
    let failure: Error | undefined;
    try {
      while (!this.isTerminated) {
        const result = await this.session.events.next();
        if (result.done || this.isTerminated) break;
        const event = result.value;
        this._lastMessageTime = new Date();
        // The provider is working, whether or not a message of ours started it.
        if (this._state.type === "idle" && event.type !== "turn.completed")
          this.setState({ type: "in-turn" });
        if (event.type === "session.started") this._nativeSessionId = event.sessionId;
        if (event.type === "model.resolved") this._resolvedModel = event.model;
        this.emit({ type: "agent", event });
        if (event.type === "turn.completed") {
          // A question the finished turn left open can no longer be answered.
          this.approvals.denyAll("Turn ended");
          this.setState({ type: "idle" });
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      loggerFor("agent-process").error(
        {
          event: "process_error",
          sessionId: this.sessionId,
          processId: this.id,
          errorMessage: failure.message,
          errorStack: failure.stack,
          currentState: this._state.type,
        },
        `Process error: ${this.sessionId} - ${failure.message}`,
      );
    }
    // A stream that ended or failed takes no more input: the process is over.
    this.markTerminated(failure ? "provider stream failed" : "provider stream ended", failure);
  }

  private markTerminated(reason: string, error?: Error): void {
    if (this.isTerminated) return;
    loggerFor("agent-process").warn(
      {
        event: "process_terminated",
        sessionId: this.sessionId,
        processId: this.id,
        reason,
        errorMessage: error?.message,
        durationMs: Date.now() - this.startedAt.getTime(),
        pendingApprovalCount: this.approvals.size,
        previousState: this._state.type,
      },
      `Process terminated: ${this.sessionId} - ${reason}`,
    );
    this.approvals.denyAll(`Process terminated: ${reason}`);
    this.setState({ type: "terminated", reason, error });
    // Whatever ended the process, its CLI and input queue go with it.
    const abortFailed = (abortError: unknown) =>
      loggerFor("agent-process").warn(
        { sessionId: this.sessionId, processId: this.id, err: abortError },
        "Provider session abort failed",
      );
    try {
      this.exited = Promise.resolve(this.session.abort()).catch(abortFailed);
    } catch (abortError) {
      abortFailed(abortError);
    }
    this.emit({ type: "terminated", reason, error });
  }

  /** Our session keeps its native id to resume; an idle worker need not live forever. */
  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this._state.type === "idle") void this.stop("Idle timeout");
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** The only way the state changes; the idle timer runs exactly while idle. */
  private setState(state: ProcessState): void {
    this._state = state;
    if (state.type === "idle") this.armIdleTimer();
    else this.clearIdleTimer();
    this.emit({ type: "state-change", state });
  }

  private emit(event: ProcessEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // One failing subscriber must not starve the others of the event.
        loggerFor("agent-process").error(
          { sessionId: this.sessionId, eventType: event.type, err: error },
          "Process event listener failed",
        );
      }
    }
  }
}
