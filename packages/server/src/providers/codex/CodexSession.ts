import { getLogger } from "../../logging/logger.js";
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

const log = getLogger().child({ component: "codex-session" });

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

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** Codex has no thinking switch; its effort ids are passed through as the app-server names them. */
function toReasoningEffort(effort?: string): (typeof REASONING_EFFORTS)[number] | undefined {
  return REASONING_EFFORTS.find((known) => known === effort);
}

/**
 * One Codex conversation on one `codex app-server`: it owns the client, the
 * thread, and — through its event adapter — which turn is running, so
 * interrupting and steering always act on the turn the events describe.
 */
export class CodexSession implements AgentSession {
  readonly queue = new MessageQueue();
  readonly events: AsyncIterableIterator<AgentEvent>;
  private readonly aborted = new AbortController();
  private readonly client: CodexAppServerClient;
  private readonly adapter: CodexEventAdapter;
  /** The thread this session runs, once the app-server has started or resumed it. */
  private threadId: string | undefined;

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
    if (options.initialMessage) this.queue.push(options.initialMessage);
    this.events = this.run();
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

  /** Add a message to the running turn; false when there is none, so the caller queues it. */
  async steer(message: UserMessage): Promise<boolean> {
    const turnId = this.adapter.activeTurn;
    if (!this.threadId || !turnId) return false;
    try {
      await this.client.request<{ turnId: string }>("turn/steer", {
        threadId: this.threadId,
        input: await this.input(message),
        expectedTurnId: turnId,
      });
      return true;
    } catch (error) {
      log.warn(
        {
          threadId: this.threadId,
          turnId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Codex turn/steer failed; caller should queue message instead",
      );
      return false;
    }
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
      log.info(
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
        const params: TurnStartParams = {
          threadId,
          input: await this.input(message),
          effort: toReasoningEffort(options.effort),
        };
        const { turn } = await client.request<TurnStartResponse>("turn/start", params);
        adapter.beginTurn(turn.id);
        log.info({ threadId, turnId: turn.id, turnStatus: turn.status }, "Started Codex turn");
        // The adapter closes the turn on its terminal notification.
        if (turn.status === "inProgress") {
          while (adapter.activeTurn && !signal.aborted) {
            const notification = await client.nextNotification(signal);
            traceProviderMessage("codex", threadId, notification);
            yield* adapter.notification(notification);
          }
        }
        // A turn that failed at turn/start, or one we stopped waiting on, still
        // ends here; a no-op when a notification already ended it.
        yield* adapter.completeTurn(
          turn.status === "failed" ? (turn.error?.message ?? "Codex turn failed") : undefined,
        );
      }
    } catch (error) {
      log.error({ error }, "Error in codex app-server session");
      if (!signal.aborted) {
        yield* adapter.fail(error instanceof Error ? error.message : String(error));
      }
    } finally {
      client.close();
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
  log.info({ method: request.method, requestId: request.id }, "Codex app-server request");
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const params = asCommandExecutionRequestApprovalParams(request.params);
      if (!params) {
        log.warn({ requestId: request.id }, "Codex command approval params invalid; declining");
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
      log.info(
        { requestId: request.id, itemId: params.itemId, decision },
        "Codex command approval",
      );
      return { decision };
    }

    case "item/fileChange/requestApproval": {
      const params = asFileChangeRequestApprovalParams(request.params);
      if (!params) {
        log.warn({ requestId: request.id }, "Codex file-change approval params invalid; declining");
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
      log.info(
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
        log.warn(
          { requestId: request.id, error },
          "Codex user-input prompt failed; answering empty",
        );
        return respond({});
      }
    }

    default:
      log.warn({ method: request.method, requestId: request.id }, "Unhandled codex server request");
      return {};
  }
}

/** Put an approval to the user; command and file-change decisions share these two answers. */
async function approve(
  onToolApproval: CanUseTool | undefined,
  toolName: string,
  input: unknown,
  signal: AbortSignal,
  /** The item being approved, so the request can be shown on its row. */
  toolUseID: string,
): Promise<"accept" | "decline"> {
  if (!onToolApproval) {
    log.warn({ toolName }, "No approval handler; declining Codex approval request");
    return "decline";
  }
  try {
    const result = await onToolApproval(toolName, input, { signal, toolUseID });
    return result.behavior === "allow" ? "accept" : "decline";
  } catch (error) {
    log.warn({ toolName, error }, "Approval handler threw; declining Codex approval request");
    return "decline";
  }
}
