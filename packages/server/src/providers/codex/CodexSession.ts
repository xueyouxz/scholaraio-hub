import { loggerFor } from "../../logging/logger.js";
import { MessageQueue, describeAttachments } from "../MessageQueue.js";
import type { AgentEvent } from "../events.js";
import { traceProviderMessage } from "../trace.js";
import type {
  AgentSession,
  CanUseTool,
  PermissionMode,
  StartSessionOptions,
  UserMessage,
} from "../types.js";
import { CodexAppServerClient, type JsonRpcServerRequest } from "./CodexAppServerClient.js";
import {
  CodexEventAdapter,
  asCommandExecutionRequestApprovalParams,
  asFileChangeRequestApprovalParams,
  asToolRequestUserInputParams,
} from "./CodexEventAdapter.js";
import type {
  AskForApproval,
  SandboxMode,
  SandboxPolicy,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ToolRequestUserInputResponse,
  TurnStartParams,
  TurnStartResponse,
  UserInput,
} from "./protocol/index.js";
import { withSkillMentions } from "./skills.js";

const log = () => loggerFor("codex-session");

/**
 * The Codex thread policy for a Hub permission mode. `approvalPolicy` stays
 * "on-request" in every mode — bypassPermissions included — so the app-server
 * keeps asking and the Hub's own policy decides (and the user sees each ask).
 * Only the sandbox underneath those decisions varies.
 */
export function codexThreadPolicy(mode: PermissionMode | undefined): {
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
} {
  const sandbox: SandboxMode =
    mode === "plan"
      ? "read-only"
      : mode === "bypassPermissions"
        ? "danger-full-access"
        : "workspace-write";
  return { approvalPolicy: "on-request", sandbox };
}

/**
 * The sandbox policy a turn sends for a mode it switches to. Workspace-write
 * reuses the thread's own policy when the thread started with one, so its
 * writable roots are kept.
 */
function turnSandboxPolicy(sandbox: SandboxMode, threadPolicy: SandboxPolicy): SandboxPolicy {
  if (sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  if (sandbox === "read-only") return { type: "readOnly", access: { type: "fullAccess" } };
  if (threadPolicy.type === "workspaceWrite") return threadPolicy;
  return {
    type: "workspaceWrite",
    writableRoots: [],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

/**
 * How long a turn Codex reported as failed may take to send `turn/completed`
 * before it is ended here.
 */
const FAILED_TURN_GRACE_MS = 10_000;

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** Codex has no thinking switch; its effort ids are passed through as the app-server names them. */
function toReasoningEffort(effort?: string): (typeof REASONING_EFFORTS)[number] | undefined {
  return REASONING_EFFORTS.find((known) => known === effort);
}

/**
 * One Codex conversation on one `codex app-server`: it owns the client, the
 * thread, and — through its event adapter — which turn is running, so
 * interrupting always acts on the turn the events describe.
 */
export class CodexSession implements AgentSession {
  readonly queue = new MessageQueue();
  readonly events: AsyncIterableIterator<AgentEvent>;
  private readonly aborted = new AbortController();
  private readonly client: CodexAppServerClient;
  private readonly adapter: CodexEventAdapter;
  /** The thread this session runs, once the app-server has started or resumed it. */
  private threadId: string | undefined;
  /** The mode the next turn runs under; a change reaches Codex with that turn. */
  private permissionMode: PermissionMode | undefined;

  constructor(
    private readonly options: StartSessionOptions,
    command: string,
    env: NodeJS.ProcessEnv,
  ) {
    this.client = new CodexAppServerClient(command, options.cwd, env);
    this.client.setServerRequestHandler((request) =>
      handleCodexServerRequest(request, options.onToolApproval, this.aborted.signal),
    );
    this.adapter = new CodexEventAdapter(options.resumeSessionId ?? "");
    this.permissionMode = options.permissionMode;
    // An app-server that dies between turns ends the session now, rather than
    // failing the next message; that message then resumes the thread anew.
    this.client.onClose((error) => {
      log().warn({ threadId: this.threadId, err: error }, "Codex app-server went away");
      this.queue.close();
    });
    if (options.initialMessage) this.queue.push(options.initialMessage);
    this.events = this.run();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  abort(): void {
    this.aborted.abort();
    this.queue.close();
    this.client.close();
  }

  isProcessAlive(): boolean {
    return this.client.isAlive();
  }

  /**
   * Codex's own cancellation (turn/interrupt). Before a turn has started there
   * is nothing to interrupt, so the session ends instead: queued input must not
   * begin after the user pressed Stop.
   */
  async interrupt(): Promise<void> {
    const turnId = this.adapter.activeTurn;
    if (!this.threadId || !turnId) {
      this.abort();
      return;
    }
    await this.client.request("turn/interrupt", { threadId: this.threadId, turnId });
  }

  /** A hub message as a turn's input: text naming every file, images, mentioned skills. */
  private input(message: UserMessage): Promise<UserInput[]> {
    return withSkillMentions(
      this.client,
      this.options.cwd,
      message.text + describeAttachments(message.attachments),
      message.attachments,
    );
  }

  private async *run(): AsyncIterableIterator<AgentEvent> {
    const { options, client, adapter } = this;
    const signal = this.aborted.signal;
    try {
      await client.open();
      const policy = codexThreadPolicy(options.permissionMode);
      let thread: ThreadResumeResponse | ThreadStartResponse;
      if (options.resumeSessionId) {
        const params: ThreadResumeParams = {
          threadId: options.resumeSessionId,
          model: options.model ?? null,
          cwd: options.cwd,
          ...policy,
        };
        thread = await client.request<ThreadResumeResponse>("thread/resume", params);
      } else {
        const params: ThreadStartParams = {
          model: options.model ?? null,
          cwd: options.cwd,
          ...policy,
          experimentalRawEvents: false,
        };
        thread = await client.request<ThreadStartResponse>("thread/start", params);
      }
      const threadId = thread.thread.id;
      this.threadId = threadId;
      let appliedMode = options.permissionMode;
      log().info(
        {
          threadId,
          permissionMode: options.permissionMode ?? "default",
          ...policy,
          model: options.model ?? null,
        },
        "Started Codex app-server session thread",
      );
      yield* adapter.started(threadId);

      for await (const message of this.queue.messages()) {
        if (signal.aborted) break;
        const mode = this.permissionMode;
        const turnPolicy = codexThreadPolicy(mode);
        const params: TurnStartParams = {
          threadId,
          input: await this.input(message),
          effort: toReasoningEffort(options.effort),
          // The policy holds for later turns too; send it only when it changes.
          ...(mode === appliedMode
            ? {}
            : {
                approvalPolicy: turnPolicy.approvalPolicy,
                sandboxPolicy: turnSandboxPolicy(turnPolicy.sandbox, thread.sandbox),
              }),
        };
        const { turn } = await client.request<TurnStartResponse>("turn/start", params);
        appliedMode = mode;
        adapter.beginTurn(turn.id);
        log().info({ threadId, turnId: turn.id, turnStatus: turn.status }, "Started Codex turn");
        // The adapter closes the turn on its terminal notification.
        if (turn.status === "inProgress") {
          while (adapter.activeTurn && !signal.aborted) {
            const notification = await this.nextNotification(signal);
            if (!notification) break;
            traceProviderMessage("codex", threadId, notification);
            yield* adapter.notification(notification);
          }
        }
        // A turn that failed at turn/start, or one we stopped waiting on, still
        // ends here; a no-op when a notification already ended it.
        yield* adapter.completeTurn(
          turn.status === "failed" ? (turn.error?.message ?? "Codex turn failed") : adapter.failure,
        );
      }
    } catch (error) {
      log().error({ err: error }, "Error in codex app-server session");
      if (!signal.aborted) {
        yield* adapter.fail(error instanceof Error ? error.message : String(error));
      }
    } finally {
      client.close();
    }
  }

  /**
   * The next notification; none once a turn Codex reported as failed has gone
   * `FAILED_TURN_GRACE_MS` without its `turn/completed`.
   */
  private async nextNotification(signal: AbortSignal) {
    if (!this.adapter.failure) return this.client.nextNotification(signal);
    const grace = AbortSignal.any([signal, AbortSignal.timeout(FAILED_TURN_GRACE_MS)]);
    try {
      return await this.client.nextNotification(grace);
    } catch (error) {
      if (grace.aborted && !signal.aborted) return undefined;
      throw error;
    }
  }
}

/**
 * Answer what the app-server asks a running session: command and file-change
 * approvals, and questions for the user (asked through the same AskUserQuestion
 * flow as Claude, so the user sees one kind of prompt whichever agent asks).
 */
export async function handleCodexServerRequest(
  request: JsonRpcServerRequest,
  onToolApproval: CanUseTool | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  log().info({ method: request.method, requestId: request.id }, "Codex app-server request");
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const params = asCommandExecutionRequestApprovalParams(request.params);
      if (!params) {
        log().warn({ requestId: request.id }, "Codex command approval params invalid; declining");
        return { decision: "decline" };
      }
      const input = {
        command: params.command,
        cwd: params.cwd,
        reason: params.reason,
        commandActions: params.commandActions ?? [],
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
      };
      const decision = await approve(onToolApproval, "Bash", input, signal, params.itemId);
      log().info(
        { requestId: request.id, itemId: params.itemId, decision },
        "Codex command approval",
      );
      return { decision };
    }

    case "item/fileChange/requestApproval": {
      const params = asFileChangeRequestApprovalParams(request.params);
      if (!params) {
        log().warn(
          { requestId: request.id },
          "Codex file-change approval params invalid; declining",
        );
        return { decision: "decline" };
      }
      const grantRoot = params.grantRoot ?? null;
      const input = {
        file_path: grantRoot ?? undefined,
        reason: params.reason ?? null,
        grantRoot,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
      };
      const decision = await approve(onToolApproval, "Edit", input, signal, params.itemId);
      log().info(
        { requestId: request.id, itemId: params.itemId, decision },
        "Codex file-change approval",
      );
      return { decision };
    }

    case "item/tool/requestUserInput": {
      const params = asToolRequestUserInputParams(request.params);
      const questions = params?.questions ?? [];
      const respond = (given: Record<string, string>): ToolRequestUserInputResponse => ({
        answers: Object.fromEntries(
          questions.map((question) => [
            question.id,
            { answers: given[question.question] ? [given[question.question] as string] : [] },
          ]),
        ),
      });
      if (!params || !questions.length || !onToolApproval) return respond({});
      const input = {
        questions: questions.map((question) => ({
          question: question.question,
          header: question.header,
          options: (question.options ?? []).map((option) => ({
            label: option.label,
            description: option.description,
          })),
          multiSelect: false,
          ...(question.isSecret ? { secret: true } : {}),
        })),
      };
      try {
        const result = await onToolApproval("AskUserQuestion", input, {
          signal,
          toolUseID: params.itemId,
        });
        if (result.behavior !== "allow") return respond({});
        const answers = (result.updatedInput as { answers?: Record<string, string> } | undefined)
          ?.answers;
        return respond(answers ?? {});
      } catch (error) {
        log().warn(
          { requestId: request.id, err: error },
          "Codex user-input prompt failed; answering empty",
        );
        return respond({});
      }
    }

    // Neither is put to the user yet; each gets the answer that grants nothing.
    case "item/permissions/requestApproval":
      log().warn({ requestId: request.id }, "Codex permission request declined");
      return { permissions: {}, scope: "turn" };

    case "mcpServer/elicitation/request":
      log().warn({ requestId: request.id }, "Codex MCP elicitation declined");
      return { action: "decline", content: null, _meta: null };

    default:
      // An error reply, not an empty result Codex cannot read as an answer.
      log().warn(
        { method: request.method, requestId: request.id },
        "Unhandled codex server request",
      );
      throw new Error(`Unsupported request: ${request.method}`);
  }
}

/** Put an approval to the user; command and file-change decisions share these answers. */
async function approve(
  onToolApproval: CanUseTool | undefined,
  toolName: string,
  input: unknown,
  signal: AbortSignal,
  /** The item being approved, so the request can be shown on its row. */
  toolUseID: string,
): Promise<"accept" | "decline" | "cancel"> {
  if (!onToolApproval) {
    log().warn({ toolName }, "No approval handler; declining Codex approval request");
    return "decline";
  }
  try {
    const result = await onToolApproval(toolName, input, { signal, toolUseID });
    if (result.behavior === "allow") return "accept";
    // A denial that stops the turn (as the user's "no" does) is Codex's cancel.
    return result.interrupt ? "cancel" : "decline";
  } catch (error) {
    log().warn(
      { toolName, err: error },
      "Approval handler threw; declining Codex approval request",
    );
    return "decline";
  }
}
