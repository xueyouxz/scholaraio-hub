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
import { getLogger } from "../../logging/logger.js";
import { normalizeCodexRateLimits } from "../../services/ProviderUsageLimitService.js";
import { findCodexCliPath } from "../cli-detection.js";
import { logSDKMessage } from "../messageLogger.js";
import { MessageQueue } from "../messageQueue.js";
import type { SDKMessage } from "../types.js";
import type { ToolApprovalResult } from "../types.js";
import {
  type TokenUsageSnapshot,
  asCommandExecutionRequestApprovalParams,
  asFileChangeRequestApprovalParams,
  asToolRequestUserInputParams,
  convertNotificationToSDKMessages,
  extractTextFromMessage,
  extractTurnUsage,
  getOptionalString,
  isTurnTerminalNotification,
  logSdkCorrelationDebug,
  withCodexTimestamp,
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
import type { AgentProvider, AgentSession, AuthStatus, StartSessionOptions } from "./types.js";

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

const PREFERRED_MODEL_ORDER = [
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1-codex-mini",
] as const;

const FALLBACK_CODEX_MODELS: ModelInfo[] = [
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
  { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1-Codex-Max" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1-Codex-Mini" },
];

interface AppServerModel {
  id: string;
  model?: string;
  displayName?: string;
  description?: string;
  upgrade?: string | null;
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
  readonly supportsPermissionMode = true;
  readonly supportsThinkingToggle = true;
  readonly supportsSlashCommands = true;

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
   * Queries Codex app-server's model/list endpoint with a static fallback.
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

    if (models.length === 0) {
      models = FALLBACK_CODEX_MODELS;
    }

    this.modelCache = {
      models,
      expiresAt: now + MODEL_CACHE_TTL_MS,
    };

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
      return this.normalizeModelList(appServerModels);
    } catch (error) {
      log.debug({ error }, "Failed to query Codex app-server model list, using fallback models");
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

  private normalizeModelList(models: AppServerModel[]): ModelInfo[] {
    const orderLookup = new Map<string, number>(PREFERRED_MODEL_ORDER.map((id, idx) => [id, idx]));
    const deduped = new Map<string, ModelInfo>();

    for (const model of models) {
      const modelId = (model.model || model.id || "").trim();
      if (!modelId) continue;

      deduped.set(modelId, {
        id: modelId,
        name: this.formatModelName(model.displayName || modelId),
        description: model.description,
      });

      const upgradeId = model.upgrade?.trim();
      if (upgradeId && !deduped.has(upgradeId)) {
        deduped.set(upgradeId, {
          id: upgradeId,
          name: this.formatModelName(upgradeId),
        });
      }
    }

    return [...deduped.values()]
      .map((model, index) => ({
        model,
        index,
        rank: orderLookup.get(model.id) ?? PREFERRED_MODEL_ORDER.length + index,
      }))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.model);
  }

  private formatModelName(value: string): string {
    return value
      .trim()
      .split("-")
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "gpt") return "GPT";
        if (lower === "codex") return "Codex";
        if (lower === "mini") return "Mini";
        if (lower === "max") return "Max";
        if (lower.length === 0) return "";
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join("-");
  }

  private mapEffortToReasoningEffort(
    effort?: import("@scholaraio-hub/shared").EffortLevel,
    thinking?: import("@scholaraio-hub/shared").ThinkingConfig,
  ): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
    if (thinking?.type === "disabled") {
      return "low";
    }
    if (!effort) {
      return undefined;
    }
    switch (effort) {
      case "low":
        return "low";
      case "medium":
        return "medium";
      case "high":
        return "high";
      case "max":
        return "xhigh";
    }
  }

  private mapPermissionModeToThreadPolicy(permissionMode?: StartSessionOptions["permissionMode"]): {
    approvalPolicy: CodexAskForApproval;
    sandbox: CodexSandboxMode;
  } {
    if (permissionMode === "bypassPermissions") {
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      };
    }

    if (permissionMode === "plan") {
      return {
        approvalPolicy: "on-request",
        sandbox: "read-only",
      };
    }

    return {
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    };
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
    const iterator = this.runSession(
      options,
      queue,
      abortController.signal,
      runtimeState,
      (client) => {
        activeClient = client;
      },
    );

    return {
      iterator,
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
  ): AsyncIterableIterator<SDKMessage> {
    const codexCommand = await this.resolveCodexCommand();
    const appServer = new CodexAppServerClient(codexCommand, options.cwd, this.getCodexEnv());
    setActiveClient(appServer);

    let sessionId = options.resumeSessionId ?? "";
    const usageByTurnId = new Map<string, TokenUsageSnapshot>();
    const logMessage = (message: SDKMessage): SDKMessage => {
      const messageSessionId =
        typeof (message as { session_id?: unknown }).session_id === "string"
          ? ((message as { session_id: string }).session_id ?? "unknown")
          : sessionId || "unknown";
      logSDKMessage(messageSessionId, message, { provider: "codex" });
      return message;
    };

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

      // Emit init immediately with the real session ID.
      yield logMessage(
        withCodexTimestamp({
          type: "system",
          subtype: "init",
          session_id: sessionId,
          cwd: options.cwd,
        } as SDKMessage),
      );

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

        // Emit user message with UUID from queue to enable deduplication.
        const userMessage = withCodexTimestamp({
          type: "user",
          uuid: message.uuid,
          session_id: sessionId,
          message: {
            role: "user",
            content: userPrompt,
          },
        } as SDKMessage);
        logSdkCorrelationDebug(sessionId, userMessage, {
          eventKind: "user_message",
          phase: "submitted",
          sourceEvent: "queued_input",
        });
        yield logMessage(userMessage);

        const turnStartParams: TurnStartParams = {
          threadId: sessionId,
          input: [{ type: "text", text: userPrompt, text_elements: [] }],
          effort: this.mapEffortToReasoningEffort(options.effort, options.thinking),
        };
        const turnResult = await appServer.request<TurnStartResponse>(
          "turn/start",
          turnStartParams,
        );

        const activeTurnId = turnResult.turn.id;
        runtimeState.activeTurnId = activeTurnId;
        log.info(
          {
            sessionId,
            turnId: activeTurnId,
            turnStatus: turnResult.turn.status,
          },
          "Started Codex app-server turn",
        );
        let turnComplete = turnResult.turn.status !== "inProgress";
        let emittedTurnError = false;

        while (!turnComplete && !signal.aborted) {
          const notification = await appServer.nextNotification(signal);

          if (notification.method === "thread/tokenUsage/updated") {
            const usage = extractTurnUsage(notification.params);
            if (usage) {
              usageByTurnId.set(usage.turnId, usage.snapshot);
            }
          }

          const messages = convertNotificationToSDKMessages(notification, sessionId, usageByTurnId);
          for (const msg of messages) {
            yield logMessage(msg);
          }

          if (isTurnTerminalNotification(notification, activeTurnId)) {
            if (notification.method === "error") {
              emittedTurnError = true;
            }
            turnComplete = true;
          }
        }
        runtimeState.activeTurnId = null;

        // If turn failed without an emitted error notification, surface start response error.
        if (
          !emittedTurnError &&
          turnResult.turn.status === "failed" &&
          turnResult.turn.error?.message
        ) {
          yield logMessage({
            type: "error",
            session_id: sessionId,
            error: turnResult.turn.error.message,
          } as SDKMessage);
        }

        yield logMessage({
          type: "result",
          session_id: sessionId,
        } as SDKMessage);
      }
    } catch (error) {
      log.error({ error }, "Error in codex app-server session");
      if (!signal.aborted) {
        yield logMessage({
          type: "error",
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        } as SDKMessage);
      }
    } finally {
      runtimeState.activeTurnId = null;
      appServer.close();
    }

    yield logMessage({
      type: "result",
      session_id: sessionId,
    } as SDKMessage);
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

      case "item/tool/requestUserInput": {
        const requestInput = asToolRequestUserInputParams(request.params);
        const questions = requestInput?.questions ?? [];

        // MVP: return empty answers so request can complete without blocking.
        const answers: ToolRequestUserInputResponse["answers"] = {};
        for (const question of questions) {
          answers[question.id] = { answers: [] };
        }
        log.warn(
          {
            method: request.method,
            requestId: request.id,
            questionCount: questions.length,
            threadId: requestInput?.threadId ?? null,
            turnId: requestInput?.turnId ?? null,
            itemId: requestInput?.itemId ?? null,
          },
          "Codex requested tool user input; returning empty answers in MVP",
        );
        const response: ToolRequestUserInputResponse = { answers };
        return response;
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
  ): Promise<TDecision> {
    if (!options.onToolApproval) {
      log.warn({ toolName }, "No onToolApproval handler available; denying Codex approval request");
      return denyDecision;
    }

    let result: ToolApprovalResult;
    try {
      result = await options.onToolApproval(toolName, toolInput, { signal });
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
