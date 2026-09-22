import { filterEnvForChildProcess } from "./env-filter.js";
/**
 * Codex Provider implementation using codex app-server JSON-RPC.
 *
 * Uses `codex app-server --listen stdio://` for turn execution so we can handle
 * server-initiated permission requests (command/file approval).
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ModelInfo, ProviderUsageLimits } from "@scholaraio-hub/shared";
import type { AgentEvent } from "../../agent/events.js";
import { getLogger } from "../../logging/logger.js";
import { normalizeCodexRateLimits } from "../../services/ProviderUsageLimitService.js";
import { findCodexCliPath } from "../cli-detection.js";
import { MessageQueue } from "../messageQueue.js";
import type { ToolApprovalResult } from "../types.js";
import {
  CodexEventAdapter,
  asCommandExecutionRequestApprovalParams,
  asFileChangeRequestApprovalParams,
  asToolRequestUserInputParams,
  extractTextFromMessage,
  getOptionalString,
  isTurnTerminalNotification,
} from "./codex-events.js";
import type {
  AskForApproval as CodexAskForApproval,
  SandboxMode as CodexSandboxMode,
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ToolRequestUserInputResponse,
  TurnStartParams,
  TurnStartResponse,
} from "./codex-protocol/index.js";
import {
  CodexAppServerClient,
  type JsonRpcResponse,
  type JsonRpcServerRequest,
  terminateChildProcess,
} from "./codex-rpc.js";
import { providerPosture } from "./permission-policy.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ProviderCapabilities,
  StartSessionOptions,
} from "./types.js";

const log = getLogger().child({ component: "codex-provider" });

/**
 * Configuration for Codex provider.
 */
export interface CodexProviderConfig {
  /** Path to codex binary (auto-detected if not specified) */
  codexPath?: string;
  /** API base URL override */
  baseUrl?: string;
  /** API key override (normally read from ~/.codex/auth.json) */
  apiKey?: string;
}

const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
const MODEL_LIST_TIMEOUT_MS = 8000;
const USAGE_LIMITS_TIMEOUT_MS = 8000;
const APP_SERVER_INIT_REQUEST_ID = 1;
const APP_SERVER_MODEL_LIST_REQUEST_ID = 2;

/** The fields of app-server `model/list` entries the hub shows (see generated v2 `Model`). */
export interface AppServerModel {
  id: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
  defaultReasoningEffort?: string;
}

interface CodexTurnRuntimeState {
  threadId: string;
  activeTurnId: string | null;
}

/**
 * Codex Provider implementation using app-server JSON-RPC.
 */
export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  readonly displayName = "Codex";
  readonly capabilities: ProviderCapabilities = {
    permissionMode: true,
    thinkingToggle: true,
    slashCommands: true,
  };

  private readonly config: CodexProviderConfig;
  private modelCache: { models: ModelInfo[]; expiresAt: number } | null = null;

  constructor(config: CodexProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Check if the Codex CLI is installed.
   */
  async isInstalled(): Promise<boolean> {
    return this.isCodexCliInstalled();
  }

  /**
   * Check if Codex CLI is installed by looking in PATH and common locations.
   */
  private async isCodexCliInstalled(): Promise<boolean> {
    if (this.config.codexPath) {
      try {
        await promisify(execFile)(this.config.codexPath, ["--version"], { timeout: 10000 });
        return true;
      } catch {
        return false;
      }
    }
    return (await findCodexCliPath()) !== null;
  }

  /**
   * Resolve the codex command: explicit config, PATH, or common install locations.
   */
  private async resolveCodexCommand(): Promise<string> {
    if (this.config.codexPath) return this.config.codexPath;
    return (await findCodexCliPath()) ?? "codex";
  }

  private getCodexClientName(): string {
    return "scholaraio-hub";
  }

  /**
   * Build environment overrides for Codex subprocesses.
   */
  private getCodexEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = filterEnvForChildProcess();
    if (this.config.baseUrl) {
      env.OPENAI_BASE_URL = this.config.baseUrl;
    }
    if (this.config.apiKey) {
      env.OPENAI_API_KEY = this.config.apiKey;
    }
    return env;
  }

  /**
   * Check if Codex is authenticated.
   */
  async isAuthenticated(): Promise<boolean> {
    const authStatus = await this.getAuthStatus();
    return authStatus.authenticated;
  }

  /**
   * Get detailed authentication status.
   * Ask the executable itself; a path on disk does not prove availability or login.
   */
  async getAuthStatus(): Promise<AuthStatus> {
    const installed = await this.isCodexCliInstalled();
    const env = this.getCodexEnv();
    let authenticated =
      installed &&
      ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"].some((name) =>
        Boolean(env[name]?.trim()),
      );
    if (installed && !authenticated) {
      try {
        await promisify(execFile)(await this.resolveCodexCommand(), ["login", "status"], {
          timeout: 10000,
          env: this.getCodexEnv(),
        });
        authenticated = true;
      } catch {
        // The login status command communicates logged-out state with its exit code.
        authenticated = false;
      }
    }
    return { installed, authenticated, enabled: authenticated };
  }

  /**
   * Get available models for Codex cloud.
   * Queries Codex app-server's model/list endpoint. No list means no models are offered.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.modelCache && this.modelCache.expiresAt > now) {
      return this.modelCache.models;
    }

    let models: ModelInfo[] = [];
    if (await this.isCodexCliInstalled()) {
      models = await this.getModelsFromAppServer();
    }

    // A failed query is retried on the next request instead of cached as "no models".
    if (models.length > 0) {
      this.modelCache = {
        models,
        expiresAt: now + MODEL_CACHE_TTL_MS,
      };
    }

    return models;
  }

  async getUsageLimits(): Promise<ProviderUsageLimits> {
    const codexCommand = await this.resolveCodexCommand();
    const appServer = new CodexAppServerClient(codexCommand, process.cwd(), this.getCodexEnv());

    try {
      await appServer.connect();
      await appServer.request<{ userAgent: string }>("initialize", {
        clientInfo: {
          name: this.getCodexClientName(),
          version: "dev",
        },
        capabilities: null,
      });
      appServer.notify("initialized");

      const payload = await Promise.race([
        appServer.request<unknown>("account/rateLimits/read"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out querying Codex usage limits")),
            USAGE_LIMITS_TIMEOUT_MS,
          ),
        ),
      ]);
      const limits = normalizeCodexRateLimits(this.name, payload, "codex-app-server");
      if (!limits) {
        return {
          provider: this.name,
          available: false,
          windows: [],
          error: "Codex app-server did not return usage limit windows.",
        };
      }
      return limits;
    } finally {
      appServer.close();
    }
  }

  private async getModelsFromAppServer(): Promise<ModelInfo[]> {
    try {
      const appServerModels = await this.requestAppServerModelList();
      return toCodexModels(appServerModels);
    } catch (error) {
      log.warn({ error }, "Failed to query Codex app-server model list; offering none");
      return [];
    }
  }

  private async requestAppServerModelList(): Promise<AppServerModel[]> {
    const codexCommand = await this.resolveCodexCommand();
    return new Promise((resolve, reject) => {
      const child = spawn(codexCommand, ["app-server", "--listen", "stdio://"], {
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: this.getCodexEnv(),
        shell: process.platform === "win32",
      });

      let settled = false;
      let stdoutBuffer = "";
      const stderrChunks: string[] = [];

      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        void terminateChildProcess(child);
        handler();
      };

      const parseAndHandleLine = (line: string) => {
        let message: JsonRpcResponse;
        try {
          message = JSON.parse(line) as JsonRpcResponse;
        } catch {
          return;
        }

        if (message.id === APP_SERVER_INIT_REQUEST_ID) {
          if (message.error) {
            const errorMessage = message.error.message ?? "Codex app-server initialize failed";
            finish(() => reject(new Error(errorMessage)));
            return;
          }

          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: APP_SERVER_MODEL_LIST_REQUEST_ID,
              method: "model/list",
              params: { limit: 100 },
            })}\n`,
          );
          return;
        }

        if (message.id !== APP_SERVER_MODEL_LIST_REQUEST_ID) {
          return;
        }

        if (message.error) {
          const errorMessage = message.error.message ?? "Codex app-server model/list failed";
          finish(() => reject(new Error(errorMessage)));
          return;
        }

        const result = message.result as { data?: unknown[] } | undefined;
        const data = Array.isArray(result?.data) ? result.data : [];
        const models: AppServerModel[] = [];

        for (const item of data) {
          if (!item || typeof item !== "object") continue;
          const model = item as AppServerModel;
          if (typeof model.id !== "string") continue;
          models.push(model);
        }

        finish(() => resolve(models));
      };

      const timeoutHandle = setTimeout(() => {
        const stderr = stderrChunks.join("").trim();
        finish(() =>
          reject(
            new Error(
              stderr
                ? `Timed out querying Codex app-server model list: ${stderr}`
                : "Timed out querying Codex app-server model list",
            ),
          ),
        );
      }, MODEL_LIST_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf-8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          parseAndHandleLine(line);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk.toString("utf-8"));
      });

      child.on("error", (error) => {
        finish(() => reject(error));
      });

      child.on("exit", (code, signal) => {
        if (settled) return;
        const stderr = stderrChunks.join("").trim();
        const details = stderr ? ` stderr: ${stderr}` : "";
        finish(() =>
          reject(
            new Error(
              `Codex app-server exited before model/list response (code=${code ?? "null"}, signal=${signal ?? "null"}).${details}`,
            ),
          ),
        );
      });

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: APP_SERVER_INIT_REQUEST_ID,
          method: "initialize",
          params: {
            clientInfo: {
              name: this.getCodexClientName(),
              version: "dev",
            },
            capabilities: null,
          },
        })}\n`,
      );
    });
  }

  /**
   * Translate a hub permission mode into Codex thread policy.
   *
   * `approvalPolicy` stays "on-request" in every mode — including
   * bypassPermissions — so the app-server keeps asking us and our own policy
   * (and the audit trail that goes with it) decides. Only the sandbox boundary
   * varies by mode. See sdk/providers/permission-policy.ts.
   */
  private mapPermissionModeToThreadPolicy(permissionMode?: StartSessionOptions["permissionMode"]): {
    approvalPolicy: CodexAskForApproval;
    sandbox: CodexSandboxMode;
  } {
    const posture = providerPosture(permissionMode);
    const sandbox: CodexSandboxMode =
      posture.sandbox === "read-only"
        ? "read-only"
        : posture.sandbox === "full-access"
          ? "danger-full-access"
          : "workspace-write";
    return { approvalPolicy: "on-request", sandbox };
  }

  /**
   * Start a new Codex session.
   */
  async startSession(options: StartSessionOptions): Promise<AgentSession> {
    const queue = new MessageQueue();
    const abortController = new AbortController();
    const runtimeState: CodexTurnRuntimeState = {
      threadId: options.resumeSessionId ?? "",
      activeTurnId: null,
    };

    // Push initial message if provided
    if (options.initialMessage) {
      queue.push(options.initialMessage);
    }

    let activeClient: CodexAppServerClient | null = null;
    const events = this.runSession(
      options,
      queue,
      abortController.signal,
      runtimeState,
      (client) => {
        activeClient = client;
      },
    );

    return {
      events,
      queue,
      abort: () => {
        abortController.abort();
        queue.push({ text: "" });
        activeClient?.close();
      },
      isProcessAlive: () => activeClient?.isAlive() ?? false,
      get pid() {
        return activeClient?.pid;
      },
      // Same native cancellation route as YepAnywhere. If a turn has not started
      // yet, terminate this worker so queued input cannot begin after Stop.
      interrupt: async () => {
        if (!activeClient || !runtimeState.threadId || !runtimeState.activeTurnId) {
          abortController.abort();
          queue.push({ text: "" });
          activeClient?.close();
          return;
        }
        await activeClient.request("turn/interrupt", {
          threadId: runtimeState.threadId,
          turnId: runtimeState.activeTurnId,
        });
      },
      steer: async (message) => {
        if (!activeClient) return false;
        if (!runtimeState.threadId || !runtimeState.activeTurnId) return false;

        const userPrompt = extractTextFromMessage(message);
        if (!userPrompt) return true;

        try {
          await activeClient.request<{ turnId: string }>("turn/steer", {
            threadId: runtimeState.threadId,
            input: [{ type: "text", text: userPrompt, text_elements: [] }],
            expectedTurnId: runtimeState.activeTurnId,
          });
          return true;
        } catch (error) {
          log.warn(
            {
              threadId: runtimeState.threadId,
              turnId: runtimeState.activeTurnId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Codex turn/steer failed; caller should queue message instead",
          );
          return false;
        }
      },
    };
  }

  /**
   * Main session loop using codex app-server.
   */
  private async *runSession(
    options: StartSessionOptions,
    queue: MessageQueue,
    signal: AbortSignal,
    runtimeState: CodexTurnRuntimeState,
    setActiveClient: (client: CodexAppServerClient) => void,
  ): AsyncIterableIterator<AgentEvent> {
    const codexCommand = await this.resolveCodexCommand();
    const appServer = new CodexAppServerClient(codexCommand, options.cwd, this.getCodexEnv());
    setActiveClient(appServer);

    let sessionId = options.resumeSessionId ?? "";
    const adapter = new CodexEventAdapter(sessionId);

    appServer.setServerRequestHandler(async (request) => {
      return await this.handleServerRequestApproval(request, options, signal);
    });

    try {
      await appServer.connect();

      await appServer.request<{ userAgent: string }>("initialize", {
        clientInfo: {
          name: this.getCodexClientName(),
          version: "dev",
        },
        capabilities: null,
      });
      appServer.notify("initialized");

      const policy = this.mapPermissionModeToThreadPolicy(options.permissionMode);

      const threadResumeParams: ThreadResumeParams = {
        threadId: options.resumeSessionId ?? sessionId,
        model: options.model ?? null,
        cwd: options.cwd,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
      };
      const threadStartParams: ThreadStartParams = {
        model: options.model ?? null,
        cwd: options.cwd,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
        experimentalRawEvents: false,
      };
      const threadResult: ThreadResumeResponse | ThreadStartResponse = options.resumeSessionId
        ? await appServer.request<ThreadResumeResponse>("thread/resume", threadResumeParams)
        : await appServer.request<ThreadStartResponse>("thread/start", threadStartParams);

      sessionId = threadResult.thread.id;
      runtimeState.threadId = sessionId;
      log.info(
        {
          sessionId,
          permissionMode: options.permissionMode ?? "default",
          approvalPolicy: policy.approvalPolicy,
          sandbox: policy.sandbox,
          model: options.model ?? null,
        },
        "Started Codex app-server session thread",
      );

      yield* adapter.started(sessionId);

      const messageGen = queue.generator();
      let isFirstMessage = !options.resumeSessionId;

      for await (const message of messageGen) {
        if (signal.aborted) {
          break;
        }

        let userPrompt = extractTextFromMessage(message);
        if (!userPrompt) {
          continue;
        }

        // Prepend global instructions to the first message of new sessions
        if (isFirstMessage && options.globalInstructions) {
          userPrompt = `[Global context]\n${options.globalInstructions}\n\n---\n\n${userPrompt}`;
          isFirstMessage = false;
        } else {
          isFirstMessage = false;
        }

        const turnStartParams: TurnStartParams = {
          threadId: sessionId,
          input: [{ type: "text", text: userPrompt, text_elements: [] }],
          effort: toReasoningEffort(options.effort),
        };
        const turnResult = await appServer.request<TurnStartResponse>(
          "turn/start",
          turnStartParams,
        );

        const activeTurnId = turnResult.turn.id;
        runtimeState.activeTurnId = activeTurnId;
        adapter.beginTurn(activeTurnId);
        log.info(
          {
            sessionId,
            turnId: activeTurnId,
            turnStatus: turnResult.turn.status,
          },
          "Started Codex app-server turn",
        );

        let turnComplete = turnResult.turn.status !== "inProgress";
        while (!turnComplete && !signal.aborted) {
          const notification = await appServer.nextNotification(signal);
          yield* adapter.notification(notification);
          turnComplete = isTurnTerminalNotification(notification, activeTurnId);
        }
        runtimeState.activeTurnId = null;

        // A turn that failed at turn/start, or one we stopped waiting on, still
        // ends here; completeTurn is a no-op if a notification already ended it.
        yield* adapter.completeTurn(
          turnResult.turn.status === "failed"
            ? (turnResult.turn.error?.message ?? "Codex turn failed")
            : undefined,
        );
      }
    } catch (error) {
      log.error({ error }, "Error in codex app-server session");
      if (!signal.aborted) {
        yield* adapter.fail(error instanceof Error ? error.message : String(error));
      }
    } finally {
      runtimeState.activeTurnId = null;
      appServer.close();
    }
  }

  private async handleServerRequestApproval(
    request: JsonRpcServerRequest,
    options: StartSessionOptions,
    signal: AbortSignal,
  ): Promise<unknown> {
    log.info(
      {
        method: request.method,
        requestId: request.id,
        permissionMode: options.permissionMode ?? "default",
      },
      "Codex app-server sent server request",
    );

    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : {};

    switch (request.method) {
      case "item/commandExecution/requestApproval": {
        const commandParams = asCommandExecutionRequestApprovalParams(request.params);
        if (!commandParams) {
          log.warn(
            {
              method: request.method,
              requestId: request.id,
            },
            "Codex command approval params invalid; declining",
          );
          return { decision: "decline" as CommandExecutionApprovalDecision };
        }
        log.info(
          {
            method: request.method,
            requestId: request.id,
            threadId: commandParams.threadId,
            turnId: commandParams.turnId,
            itemId: commandParams.itemId,
            command: commandParams.command,
            cwd: commandParams.cwd,
          },
          "Handling Codex command approval request",
        );
        const toolInput = {
          command: commandParams.command,
          cwd: commandParams.cwd,
          reason: commandParams.reason,
          commandActions: commandParams.commandActions ?? [],
          proposedExecpolicyAmendment: commandParams.proposedExecpolicyAmendment ?? null,
          threadId: commandParams.threadId,
          turnId: commandParams.turnId,
          itemId: commandParams.itemId,
        };
        const decision: CommandExecutionApprovalDecision = await this.resolveApprovalDecision(
          options,
          "Bash",
          toolInput,
          signal,
          "accept",
          "decline",
          commandParams.itemId,
        );
        log.info(
          {
            method: request.method,
            requestId: request.id,
            threadId: commandParams.threadId,
            turnId: commandParams.turnId,
            itemId: commandParams.itemId,
            decision,
          },
          "Resolved Codex command approval request",
        );
        return { decision };
      }

      case "item/fileChange/requestApproval": {
        const fileParams = asFileChangeRequestApprovalParams(request.params);
        if (!fileParams) {
          log.warn(
            {
              method: request.method,
              requestId: request.id,
            },
            "Codex file-change approval params invalid; declining",
          );
          return { decision: "decline" as FileChangeApprovalDecision };
        }
        const grantRoot = fileParams.grantRoot ?? null;
        log.info(
          {
            method: request.method,
            requestId: request.id,
            threadId: fileParams.threadId,
            turnId: fileParams.turnId,
            itemId: fileParams.itemId,
            grantRoot,
          },
          "Handling Codex file-change approval request",
        );
        const toolInput = {
          file_path: grantRoot ?? undefined,
          reason: fileParams.reason ?? null,
          grantRoot,
          threadId: fileParams.threadId,
          turnId: fileParams.turnId,
          itemId: fileParams.itemId,
        };
        const decision: FileChangeApprovalDecision = await this.resolveApprovalDecision(
          options,
          "Edit",
          toolInput,
          signal,
          "accept",
          "decline",
          fileParams.itemId,
        );
        log.info(
          {
            method: request.method,
            requestId: request.id,
            threadId: fileParams.threadId,
            turnId: fileParams.turnId,
            itemId: fileParams.itemId,
            decision,
          },
          "Resolved Codex file-change approval request",
        );
        return { decision };
      }

      // Backward-compatible protocol variants.
      case "execCommandApproval": {
        const commandParts = Array.isArray(params.command)
          ? params.command.filter((part): part is string => typeof part === "string")
          : [];
        const toolInput = {
          command: commandParts.join(" "),
          cwd: getOptionalString(params.cwd),
          reason: getOptionalString(params.reason),
          parsedCmd: Array.isArray(params.parsedCmd) ? params.parsedCmd : [],
          callId: getOptionalString(params.callId),
        };
        const decision = await this.resolveApprovalDecision(
          options,
          "Bash",
          toolInput,
          signal,
          "approved",
          "denied",
          toolInput.callId ?? undefined,
        );
        log.info(
          {
            method: request.method,
            requestId: request.id,
            decision,
            command: toolInput.command,
            cwd: toolInput.cwd,
          },
          "Resolved legacy Codex command approval request",
        );
        return { decision };
      }

      case "applyPatchApproval": {
        const fileChanges =
          params.fileChanges && typeof params.fileChanges === "object"
            ? (params.fileChanges as Record<string, unknown>)
            : {};
        const paths = Object.keys(fileChanges);
        const toolInput = {
          changes: paths.map((path) => ({ path, kind: "update" })),
          reason: getOptionalString(params.reason),
          grantRoot: getOptionalString(params.grantRoot),
          callId: getOptionalString(params.callId),
        };
        const decision = await this.resolveApprovalDecision(
          options,
          "Edit",
          toolInput,
          signal,
          "approved",
          "denied",
          toolInput.callId ?? undefined,
        );
        log.info(
          {
            method: request.method,
            requestId: request.id,
            decision,
            changedPathCount: paths.length,
            grantRoot: toolInput.grantRoot,
          },
          "Resolved legacy Codex apply-patch approval request",
        );
        return { decision };
      }

      // Codex asking the user something: the same question flow as Claude's
      // AskUserQuestion, so the user sees one kind of prompt whichever agent asks.
      case "item/tool/requestUserInput": {
        const requestInput = asToolRequestUserInputParams(request.params);
        const questions = requestInput?.questions ?? [];
        const respond = (given: Record<string, string>): ToolRequestUserInputResponse => ({
          answers: Object.fromEntries(
            questions.map((question) => [
              question.id,
              { answers: given[question.question] ? [given[question.question] as string] : [] },
            ]),
          ),
        });
        if (!requestInput || !questions.length || !options.onToolApproval) return respond({});

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
          const result = await options.onToolApproval("AskUserQuestion", input, {
            signal,
            toolUseID: requestInput.itemId,
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

      default: {
        log.warn(
          { method: request.method, requestId: request.id },
          "Unhandled codex server request",
        );
        return {};
      }
    }
  }

  private async resolveApprovalDecision<TDecision extends string>(
    options: StartSessionOptions,
    toolName: string,
    toolInput: unknown,
    signal: AbortSignal,
    allowDecision: TDecision,
    denyDecision: TDecision,
    /** The item being approved, so the request can be shown on its row. */
    toolUseID?: string,
  ): Promise<TDecision> {
    if (!options.onToolApproval) {
      log.warn({ toolName }, "No onToolApproval handler available; denying Codex approval request");
      return denyDecision;
    }

    let result: ToolApprovalResult;
    try {
      result = await options.onToolApproval(toolName, toolInput, { signal, toolUseID });
    } catch (error) {
      log.warn({ toolName, error }, "onToolApproval threw; denying Codex approval request");
      return denyDecision;
    }

    log.info({ toolName, behavior: result.behavior }, "Resolved tool approval callback result");

    return result.behavior === "allow" ? allowDecision : denyDecision;
  }
}

/**
 * Default Codex provider instance.
 */
export const codexProvider = new CodexProvider();

/** Visible `model/list` entries in the app-server's own order, naming and effort levels. */
export function toCodexModels(models: AppServerModel[]): ModelInfo[] {
  const seen = new Set<string>();
  const result: ModelInfo[] = [];
  for (const model of models) {
    const id = (model.model || model.id || "").trim();
    if (!id || model.hidden || seen.has(id)) continue;
    seen.add(id);
    const efforts = model.supportedReasoningEfforts ?? [];
    result.push({
      id,
      name: model.displayName || id,
      ...(model.description ? { description: model.description } : {}),
      ...(model.isDefault ? { isDefault: true } : {}),
      ...(efforts.length
        ? {
            efforts: efforts.map((effort) => ({
              id: effort.reasoningEffort,
              ...(effort.description ? { description: effort.description } : {}),
            })),
          }
        : {}),
      ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
    });
  }
  return result;
}

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

/** Codex has no thinking switch; its effort ids are passed through as the app-server names them. */
function toReasoningEffort(effort?: string): (typeof REASONING_EFFORTS)[number] | undefined {
  return REASONING_EFFORTS.find((known) => known === effort);
}
