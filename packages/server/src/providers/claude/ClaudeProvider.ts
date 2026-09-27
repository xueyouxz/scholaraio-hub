import { execFile, spawn } from "node:child_process";
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import {
  type Query,
  type CanUseTool as SDKCanUseTool,
  type SDKUserMessage,
  type ModelInfo as SdkModelInfo,
  type SpawnedProcess,
  forkSession,
  getSessionMessages,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ATTACHMENT_LIMITS,
  type ModelInfo,
  type ProviderUsageLimits,
  type SessionContextUsage,
  type SlashCommand,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../../logging/logger.js";
import { outboundFetch } from "../../utils/outboundFetch.js";
import { withTimeout } from "../../utils/timeout.js";
import { MessageQueue, describeAttachments, isInlineImage } from "../MessageQueue.js";
import { type AgentLibrary, agentEnv } from "../agent-env.js";
import type { AgentEvent } from "../events.js";
import { traceProviderMessage } from "../trace.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ForkSessionOptions,
  ProviderCapabilities,
  ProviderName,
  StartSessionOptions,
  UserMessage,
} from "../types.js";
import { normalizeClaudeOAuthUsage } from "../usage-limits.js";
import { ClaudeEventAdapter } from "./ClaudeEventAdapter.js";
import type { SDKMessage } from "./sdk-message.js";

const execFileAsync = promisify(execFile);
const log = () => loggerFor("claude-provider");

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
const requireFromHere = createRequire(import.meta.url);
const requireFromClaudeSdk = createRequire(
  requireFromHere.resolve("@anthropic-ai/claude-agent-sdk"),
);
const CLAUDE_CODE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const USAGE_LIMITS_TIMEOUT_MS = 8000;

/**
 * Absolute path to the local `claude` executable the SDK should spawn.
 *
 * The SDK defaults to a bundled `cli.js` that is absent in standalone installs
 * (and ships no native binary package for every platform). When the SDK can't
 * find an executable, `query()` spawns nothing, the init handshake never lands,
 * and `supportedModels()` hangs until the probe timeout — stalling
 * `/api/providers` for 15s. Resolving the executable ourselves and passing it as
 * `pathToClaudeCodeExecutable` makes the spawn deterministic.
 *
 * Resolution order (first hit wins): explicit env override → the SDK's optional
 * native binary package → `claude` on `PATH`. `undefined` lets the SDK fall back
 * to its own default (preserving prior behavior when nothing is found).
 */
const resolvedExecutables = new Map<string, string | null>();

function isExecutableFile(filePath: string | undefined): filePath is string {
  if (!filePath) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathExecutable(command: string): string | undefined {
  if (!command.trim()) return undefined;

  // An explicit path is used as-is (when executable); a bare name is searched on PATH.
  if (command.includes("/") || command.includes("\\")) {
    return isExecutableFile(command) ? command : undefined;
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    const candidate = join(dir, command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function hasGlibcRuntime(): boolean {
  if (typeof process.report?.getReport !== "function") {
    return false;
  }
  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: string };
  };
  return Boolean(report.header?.glibcVersionRuntime);
}

function getClaudeSdkNativePackageNames(): string[] {
  const binaryArch = process.arch;
  if (process.platform === "linux") {
    const glibcPackage = `@anthropic-ai/claude-agent-sdk-linux-${binaryArch}`;
    const muslPackage = `${glibcPackage}-musl`;
    return hasGlibcRuntime() ? [glibcPackage, muslPackage] : [muslPackage, glibcPackage];
  }
  return [`@anthropic-ai/claude-agent-sdk-${process.platform}-${binaryArch}`];
}

function resolveClaudeSdkNativeExecutable(): string | undefined {
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  for (const packageName of getClaudeSdkNativePackageNames()) {
    try {
      const executable = requireFromClaudeSdk.resolve(`${packageName}/${binaryName}`);
      if (isExecutableFile(executable)) {
        return executable;
      }
    } catch {
      // Optional native package not installed for this platform — try the next.
    }
  }
  return undefined;
}

/** 解析要运行的 Claude Code 可执行文件：`configured`（配置指定）优先，结果按配置缓存。 */
export function resolveLocalClaudeCodeExecutable(configured?: string): string | undefined {
  const key = configured ?? "";
  const cached = resolvedExecutables.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const executable = configured
    ? resolvePathExecutable(configured)
    : (resolveClaudeSdkNativeExecutable() ?? resolvePathExecutable("claude"));
  resolvedExecutables.set(key, executable ?? null);
  return executable;
}

/** Claude Provider 的配置；取值来自 server 配置（`CLAUDE_*` 环境变量）。 */
export interface ClaudeProviderConfig {
  /** `CLAUDE_CODE_EXECUTABLE` / `CLAUDE_CODE_PATH`：指定的 Claude Code 可执行文件。 */
  executable?: string;
  /** `CLAUDE_CODE_KEYCHAIN_SERVICE`：macOS 钥匙串中登录凭据的服务名。 */
  keychainService?: string;
  /** `CLAUDE_OAUTH_USAGE_URL`：调试用的用量接口地址。 */
  usageUrl?: string;
  /** agent 中 `scholaraio` CLI 使用的文献库。 */
  agentLibrary?: AgentLibrary;
}

/** A model exactly as the Claude CLI describes it; efforts only when it supports them. */
export function toModelInfo(model: SdkModelInfo): ModelInfo {
  const efforts = model.supportsEffort ? (model.supportedEffortLevels ?? []) : [];
  return {
    id: model.value,
    name: model.displayName,
    description: model.description,
    ...(efforts.length ? { efforts: efforts.map((id) => ({ id })) } : {}),
  };
}

/** Claude Code honours a slash command only at the start of a message. */
function toClaudeCommand(command: {
  name: string;
  description: string;
  argumentHint?: string;
}): SlashCommand {
  return {
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    source: "provider",
    trigger: "/",
    position: "leading",
  };
}

const COMMAND_CACHE_TTL_MS = 60_000;

/** Markers Claude Code writes as user messages that the user did not type. */
const NON_PROMPT_PREFIXES = [
  "[Request interrupted",
  "<local-command",
  "<command-name>",
  "<command-message>",
  "Caveat: The messages below",
];

/** A message the user sent, as opposed to a tool result or a Claude Code marker. */
function isUserPrompt(message: { type: string; message: unknown }): boolean {
  if (message.type !== "user") return false;
  const content = (message.message as { content?: unknown } | undefined)?.content;
  const blocks: Array<{ type?: unknown; text?: unknown }> =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];
  if (blocks.some((block) => block.type === "tool_result")) return false;
  const text = blocks.find((block) => block.type === "text")?.text;
  if (typeof text !== "string") return blocks.length > 0;
  return !NON_PROMPT_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix));
}
const commandCache = new Map<string, { commands: SlashCommand[]; expiresAt: number }>();

/** How long a login check stands: each one runs the CLI twice. */
const AUTH_STATUS_TTL_MS = 30_000;
/** How long the probed model list stands; a CLI update or new login can change it. */
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
/** After a failed probe, how long to offer no models before probing again (each costs up to 15s). */
const PROBE_RETRY_MS = 60_000;

/**
 * Claude provider implementation using @anthropic-ai/claude-agent-sdk.
 *
 * This class wraps the SDK's query() function and provides:
 * - MessageQueue for queuing user messages
 * - AbortController for cancellation
 * - Tool approval callbacks
 */
export class ClaudeProvider implements AgentProvider {
  constructor(private readonly config: ClaudeProviderConfig = {}) {}

  private authStatus?: { value: Promise<AuthStatus>; expiresAt: number };
  private models?: { value: ModelInfo[]; expiresAt: number };
  /** The probe in flight, shared by concurrent callers. */
  private probing?: Promise<ModelInfo[]>;
  private probeRetryAt = 0;

  readonly name: ProviderName = "claude";
  readonly displayName: string = "Claude";
  readonly capabilities: ProviderCapabilities = {
    // Claude Code's own mode titles, in its Shift+Tab order.
    permissionModes: [
      { id: "default", label: "Default" },
      { id: "acceptEdits", label: "Accept edits" },
      { id: "plan", label: "Plan Mode" },
      { id: "bypassPermissions", label: "Bypass Permissions" },
    ],
    thinkingModes: [
      { id: "adaptive", label: "Thinking on" },
      { id: "off", label: "Thinking off" },
    ],
    slashCommands: "leading",
    contextUsage: "used",
    attachments: ATTACHMENT_LIMITS,
  };

  /**
   * Get detailed authentication status.
   *
   * Authentication is detected, not assumed: an installed-but-unauthenticated CLI
   * must report `authenticated: false` so {@link getAvailableModels} returns the
   * static fallback list *without* probing. A probe against an unauthenticated CLI
   * never completes its init handshake and stalls the `/api/providers` response for
   * the full probe timeout (15s).
   *
   * Resolution order (first match wins):
   *   1. `ANTHROPIC_API_KEY` env var.
   *   2. `claude auth status` (authoritative; short 5s timeout so it can't block).
   *   3. Stored OAuth credentials (macOS Keychain, else `~/.claude/.credentials.json`).
   */
  getAuthStatus(): Promise<AuthStatus> {
    const now = Date.now();
    if (this.authStatus && this.authStatus.expiresAt > now) return this.authStatus.value;
    const value = this.readAuthStatus();
    this.authStatus = { value, expiresAt: now + AUTH_STATUS_TTL_MS };
    // A check that failed is not an answer to keep.
    value.catch(() => {
      if (this.authStatus?.value === value) this.authStatus = undefined;
    });
    return value;
  }

  private async readAuthStatus(): Promise<AuthStatus> {
    const installed = await this.isClaudeCliInstalled();
    if (!installed) {
      return { installed: false, authenticated: false, enabled: false };
    }

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { installed: true, authenticated: true, enabled: true };
    }

    const cliAuthStatus = await this.getCliAuthStatus();
    if (cliAuthStatus) {
      return cliAuthStatus;
    }

    const oauth = await this.readClaudeOAuthCredentials();
    if (!oauth || !(oauth.accessToken || oauth.refreshToken)) {
      return { installed: true, authenticated: false, enabled: false };
    }

    const expiresAt = typeof oauth.expiresAt === "number" ? new Date(oauth.expiresAt) : undefined;
    // A live refresh token keeps us authenticated even past the access token expiry.
    const authenticated = !expiresAt || expiresAt >= new Date() || Boolean(oauth.refreshToken);

    return {
      installed: true,
      authenticated,
      enabled: authenticated,
      expiresAt,
      plan: oauth.subscriptionType || undefined,
    };
  }

  /**
   * Ask the Claude CLI directly whether it is logged in. Returns null (so callers
   * fall through to credential inspection) when the CLI doesn't support
   * `auth status`, times out, or emits non-JSON output — those are expected, not
   * failures worth surfacing.
   */
  private async getCliAuthStatus(): Promise<AuthStatus | null> {
    try {
      const claudePath = resolveLocalClaudeCodeExecutable(this.config.executable);
      if (!claudePath) return null;
      const { stdout } = await execFileAsync(claudePath, ["auth", "status"], {
        encoding: "utf-8",
        timeout: 5000,
      });

      const parsed = JSON.parse(stdout) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string | null;
      };
      if (typeof parsed.loggedIn !== "boolean") {
        return null;
      }

      return {
        installed: true,
        authenticated: parsed.loggedIn,
        enabled: parsed.loggedIn,
        user: parsed.email ? { email: parsed.email } : undefined,
        plan: parsed.subscriptionType || undefined,
      };
    } catch (error) {
      log().debug({ err: error }, "`claude auth status` unavailable, falling back");
      return null;
    }
  }

  /**
   * Read the stored `claudeAiOauth` credential block. On macOS this lives in the
   * Keychain (matching {@link readClaudeCodeOAuthAccessToken}); elsewhere it's a
   * plaintext `~/.claude/.credentials.json`. Returns null when absent/unreadable.
   */
  private async readClaudeOAuthCredentials(): Promise<{
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    subscriptionType?: string | null;
  } | null> {
    try {
      let raw: string;
      if (process.platform === "darwin") {
        const service = this.config.keychainService ?? CLAUDE_CODE_KEYCHAIN_SERVICE;
        const { stdout } = await execFileAsync(
          "security",
          ["find-generic-password", "-s", service, "-w"],
          { timeout: USAGE_LIMITS_TIMEOUT_MS },
        );
        raw = stdout;
      } else {
        const credentialsPath = join(homedir(), ".claude", ".credentials.json");
        if (!existsSync(credentialsPath)) {
          return null;
        }
        raw = readFileSync(credentialsPath, "utf-8");
      }

      const parsed = JSON.parse(raw) as {
        claudeAiOauth?: {
          accessToken?: string;
          refreshToken?: string;
          expiresAt?: number;
          subscriptionType?: string | null;
        };
      };
      return parsed.claudeAiOauth ?? null;
    } catch (error) {
      log().debug({ err: error }, "No readable OAuth credentials");
      return null;
    }
  }

  /**
   * Check if Claude CLI is installed.
   * Resolve with the same precedence used to start a session, then execute it.
   */
  private async isClaudeCliInstalled(): Promise<boolean> {
    const executable = resolveLocalClaudeCodeExecutable(this.config.executable);
    if (!executable) return false;
    try {
      await execFileAsync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10000,
      });
      return true;
    } catch (error) {
      log().warn({ err: error }, "Claude CLI cannot run");
      return false;
    }
  }

  /**
   * The models the CLI offers, from a probe session. Cached for a while; after
   * a failed probe none are offered until the next retry, so a broken CLI does
   * not stall every caller for the probe timeout.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.models && this.models.expiresAt > now) return this.models.value;
    // An unauthenticated CLI never finishes its handshake; it has no models to offer.
    if (!(await this.getAuthStatus()).authenticated) return [];
    if (this.probing) return this.probing;
    if (now < this.probeRetryAt) return [];
    this.probing = this.probeModels();
    try {
      const value = await this.probing;
      this.models = { value, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
      return value;
    } catch (error) {
      this.probeRetryAt = Date.now() + PROBE_RETRY_MS;
      log().warn({ err: error }, "Failed to probe models; none offered until the next retry");
      return [];
    } finally {
      this.probing = undefined;
    }
  }

  async getUsageLimits(): Promise<ProviderUsageLimits> {
    const accessToken = await this.readClaudeCodeOAuthAccessToken();
    const payload = await this.fetchClaudeOAuthUsage(accessToken);
    const limits = normalizeClaudeOAuthUsage(this.name, payload);

    if (!limits) {
      return {
        provider: this.name,
        available: false,
        windows: [],
        error: "Claude OAuth usage API did not return usage limit windows.",
      };
    }

    return limits;
  }

  /**
   * The access token the usage endpoint wants, from wherever Claude Code keeps
   * it: the Keychain on macOS, `~/.claude/.credentials.json` elsewhere.
   */
  protected async readClaudeCodeOAuthAccessToken(): Promise<string> {
    const credentials = await this.readClaudeOAuthCredentials();
    const accessToken = credentials?.accessToken;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error("Claude Code credentials not found. Run claude auth login in a terminal.");
    }
    // An expired token is refused by the API; saying so beats an opaque 401.
    if (credentials?.expiresAt && credentials.expiresAt <= Date.now()) {
      throw new Error("Claude Code credentials have expired. Sign in again to view usage.");
    }
    return accessToken;
  }

  protected async fetchClaudeOAuthUsage(accessToken: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), USAGE_LIMITS_TIMEOUT_MS);

    try {
      // Through the proxy the environment names: direct, this endpoint answers 403.
      const response = await outboundFetch(this.config.usageUrl ?? CLAUDE_OAUTH_USAGE_URL, {
        headers: {
          accept: "application/json",
          "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
          authorization: `Bearer ${accessToken}`,
          "user-agent": "scholaraio-hub-claude-usage",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // The endpoint rate-limits polling, and refuses tokens that lost the
        // scope. Both read as "no data" to the caller, so name which it was.
        if (response.status === 429) {
          throw new Error("The usage API is rate limited. It will be retried later.");
        }
        if (response.status === 401) {
          throw new Error(
            "The current credentials cannot read usage. Sign in to Claude Code again.",
          );
        }
        // Also what a direct connection from a region Anthropic does not serve gets.
        if (response.status === 403) {
          throw new Error(
            "The usage API rejected the request (HTTP 403). Set HTTPS_PROXY if a proxy is required.",
          );
        }
        throw new Error(`The usage API returned HTTP ${response.status}.`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /** The environment an agent's CLI starts with (see agent-env.ts). */
  private getEnv(): Record<string, string | undefined> {
    return agentEnv(this.config.agentLibrary);
  }

  /**
   * Ask a throwaway CLI session something it answers during its initialize
   * handshake (models, commands), then abort it. No message is ever sent.
   */
  private async probe<T>(
    cwd: string,
    ask: (sdkQuery: Query) => Promise<T>,
    what: string,
  ): Promise<T> {
    const abortController = new AbortController();

    // Generator that waits indefinitely — keeps the SDK process alive while we
    // ask. Resolves (rather than rejects) on abort to avoid unhandled rejections.
    async function* waitForever(): AsyncGenerator<never> {
      await new Promise<never>((resolve) => {
        abortController.signal.addEventListener("abort", () => resolve(undefined as never));
      });
    }

    try {
      const sdkQuery = query({
        prompt: waitForever(),
        options: {
          cwd,
          abortController,
          permissionMode: "default",
          persistSession: false,
          // Same sources as a real session, so project commands and skills are listed.
          settingSources: ["user", "project", "local"],
          pathToClaudeCodeExecutable: resolveLocalClaudeCodeExecutable(this.config.executable),
          env: this.getEnv(),
        },
      });

      // The SDK's internal readMessages loop must be running for the
      // initialize control_response to be processed.
      void (async () => {
        try {
          for await (const _ of sdkQuery) {
            // drain
          }
        } catch {
          // Expected — abort causes an error
        }
      })();

      return await withTimeout(ask(sdkQuery), 15000, `${what} probe timed out`);
    } finally {
      abortController.abort();
    }
  }

  private async probeModels(): Promise<ModelInfo[]> {
    const models = await this.probe(homedir(), (sdkQuery) => sdkQuery.supportedModels(), "Model");
    return models.map(toModelInfo);
  }

  /**
   * Slash commands Claude Code offers in `cwd` (built-ins, custom commands,
   * skills), as its `supportedCommands()` lists them. Cached briefly per cwd.
   */
  async listCommands(cwd: string): Promise<SlashCommand[]> {
    const cached = commandCache.get(cwd);
    if (cached && cached.expiresAt > Date.now()) return cached.commands;
    const commands = (
      await this.probe(cwd, (sdkQuery) => sdkQuery.supportedCommands(), "Command")
    ).map(toClaudeCommand);
    commandCache.set(cwd, {
      commands,
      expiresAt: Date.now() + COMMAND_CACHE_TTL_MS,
    });
    return commands;
  }

  /**
   * Fork with the SDK's own `forkSession`, cut just before the first user
   * prompt that is dropped. The transcript also holds tool results, interrupt
   * markers and local-command echoes as "user" messages; only prompts count.
   */
  async forkSession({ sessionId, cwd, dropTurns }: ForkSessionOptions): Promise<string> {
    let upToMessageId: string | undefined;
    if (dropTurns > 0) {
      const messages = await getSessionMessages(sessionId, { dir: cwd });
      const prompts = messages.flatMap((message, index) => (isUserPrompt(message) ? [index] : []));
      const cut = prompts[prompts.length - dropTurns];
      upToMessageId = cut === undefined ? undefined : messages[cut - 1]?.uuid;
      if (!upToMessageId)
        throw new Error("No content before this message was found in the Claude session history");
    }
    const fork = await forkSession(sessionId, { dir: cwd, upToMessageId });
    return fork.sessionId;
  }

  /**
   * Start a new Claude session.
   */
  async startSession(options: StartSessionOptions): Promise<AgentSession> {
    const queue = new MessageQueue();
    const abortController = new AbortController();

    // Push the initial message into the queue (if provided)
    // If no message, the agent will wait until one is pushed
    if (options.initialMessage) {
      queue.push(options.initialMessage);
    }

    // Wrap our canUseTool to match SDK's expected type
    const onToolApproval = options.onToolApproval;
    const canUseTool: SDKCanUseTool | undefined = onToolApproval
      ? async (toolName, input, opts) => {
          const result = await onToolApproval(toolName, input, opts);
          log().debug({ toolName, behavior: result.behavior }, "Tool approval");
          // Convert our result to SDK's PermissionResult format
          if (result.behavior === "allow") {
            return {
              behavior: "allow" as const,
              updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
            };
          }
          return {
            behavior: "deny" as const,
            message: result.message ?? "Permission denied",
            interrupt: result.interrupt,
          };
        }
      : undefined;

    // Spawn the CLI ourselves to keep its handle: stale detection can then tell
    // "process died silently" from "process is busy with a long tool call".
    let capturedProcess: SpawnedProcess | null = null;
    const spawnClaudeCodeProcess = (
      spawnOpts: import("@anthropic-ai/claude-agent-sdk").SpawnOptions,
    ): SpawnedProcess => {
      const proc = spawn(spawnOpts.command, spawnOpts.args, {
        cwd: spawnOpts.cwd,
        env: spawnOpts.env as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      const abortHandler = () => {
        proc.kill("SIGTERM");
      };
      spawnOpts.signal.addEventListener("abort", abortHandler);
      proc.on("exit", () => {
        spawnOpts.signal.removeEventListener("abort", abortHandler);
      });
      capturedProcess = proc;
      return proc;
    };

    // Create the SDK query with our message generator
    let sdkQuery: Query;
    try {
      sdkQuery = query({
        prompt: claudePrompt(queue),
        options: {
          cwd: options.cwd,
          resume: options.resumeSessionId,
          abortController,
          // The mode reaches the SDK only to shape its system prompt; the
          // decision itself always comes back to canUseTool. bypassPermissions
          // goes in as "default" so the SDK cannot answer on its own — see
          // supervisor/permission-policy.ts.
          permissionMode:
            options.permissionMode === "bypassPermissions"
              ? "default"
              : (options.permissionMode ?? "default"),
          canUseTool,
          systemPrompt: { type: "preset", preset: "claude_code" },
          settingSources: ["user", "project", "local"],
          includePartialMessages: true,
          // Model, thinking, and effort options
          model: options.model,
          thinking: options.thinking,
          effort: toClaudeEffort(options.effort),
          // Filter env to exclude npm_*, scholaraio-hub specific, and other irrelevant vars
          env: this.getEnv(),
          pathToClaudeCodeExecutable: resolveLocalClaudeCodeExecutable(this.config.executable),
          spawnClaudeCodeProcess,
        },
      });
    } catch (error) {
      // Handle common SDK initialization errors
      if (error instanceof Error) {
        if (error.message.includes("Claude Code executable not found")) {
          throw new Error(
            "未找到 Claude CLI，请先安装：curl -fsSL https://claude.ai/install.sh | bash",
          );
        }
        if (error.message.includes("SPAWN") || error.message.includes("spawn")) {
          throw new Error(`Unable to start Claude CLI: ${error.message}`);
        }
      }
      throw error;
    }

    return {
      events: this.toAgentEvents(sdkQuery),
      queue,
      abort: () => {
        abortController.abort();
        queue.close();
      },
      isProcessAlive: () =>
        capturedProcess !== null && capturedProcess.exitCode === null && !capturedProcess.killed,
      setMaxThinkingTokens: (tokens: number | null) => sdkQuery.setMaxThinkingTokens(tokens),
      interrupt: () => sdkQuery.interrupt(),
    };
  }

  /**
   * Translate the SDK stream into AgentEvents. The raw SDK message is logged
   * (when LOG_SDK_MESSAGES is on) but never forwarded.
   */
  private async *toAgentEvents(sdkQuery: Query): AsyncIterableIterator<AgentEvent> {
    const adapter = new ClaudeEventAdapter();
    let sessionId = "unknown";

    try {
      for await (const message of sdkQuery) {
        sessionId = (message as { session_id?: string }).session_id ?? sessionId;
        traceProviderMessage("claude", sessionId, message);
        for (const event of adapter.accept(message as unknown as SDKMessage)) {
          // Report the window as `/context` counts it before the turn closes.
          if (event.type === "turn.completed" && !event.parentCallId) {
            const usage = await readClaudeContextUsage(sdkQuery);
            if (usage) yield { type: "context.usage", usage };
          }
          yield event;
        }
      }
    } catch (error) {
      // An abort is how a session ends normally.
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      // Transport failures ("ProcessTransport is not ready for writing") are
      // the AgentProcess to classify.
      throw error;
    }
  }
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

function toClaudeEffort(effort?: string): (typeof CLAUDE_EFFORTS)[number] | undefined {
  return CLAUDE_EFFORTS.find((known) => known === effort);
}

const CONTEXT_USAGE_TIMEOUT_MS = 5000;

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
    log().warn({ err: error }, "Context usage unavailable");
    return undefined;
  }
}
