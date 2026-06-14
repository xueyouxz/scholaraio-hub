import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import {
  type SDKMessage as AgentSDKMessage,
  type Query,
  type CanUseTool as SDKCanUseTool,
  type SpawnedProcess,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ModelInfo,
  type ProviderUsageLimits,
  type SlashCommand,
  getModelContextWindow,
} from "@scholaraio-hub/shared";
import { normalizeClaudeOAuthUsage } from "../../services/ProviderUsageLimitService.js";
import { detectClaudeCli } from "../cli-detection.js";
import { logSDKMessage } from "../messageLogger.js";
import { MessageQueue } from "../messageQueue.js";
import type { ContentBlock, SDKMessage } from "../types.js";
import { filterEnvForChildProcess } from "./env-filter.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

/**
 * Use a spawn wrapper to capture the child process reference for liveness checks.
 * When true, stale detection can distinguish "process died silently" from
 * "process is busy with a long tool call". Set to false to revert to the
 * old time-only heuristic if the wrapper causes issues.
 */
const USE_SPAWN_WRAPPER = true;
const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
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
let cachedLocalClaudeCodeExecutable: string | null | undefined;

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
      const executable = requireFromHere.resolve(`${packageName}/${binaryName}`);
      if (isExecutableFile(executable)) {
        return executable;
      }
    } catch {
      // Optional native package not installed for this platform — try the next.
    }
  }
  return undefined;
}

function resolveLocalClaudeCodeExecutable(): string | undefined {
  if (cachedLocalClaudeCodeExecutable !== undefined) {
    return cachedLocalClaudeCodeExecutable ?? undefined;
  }

  const envExecutable = process.env.CLAUDE_CODE_EXECUTABLE ?? process.env.CLAUDE_CODE_PATH;
  const executable =
    resolvePathExecutable(envExecutable ?? "") ??
    resolveClaudeSdkNativeExecutable() ??
    resolvePathExecutable("claude");

  cachedLocalClaudeCodeExecutable = executable ?? null;
  return executable;
}

/** Static fallback list of Claude models (used if probe fails) */
const CLAUDE_MODELS_FALLBACK: ModelInfo[] = [
  {
    id: "default",
    name: "Default (recommended)",
    description: "Claude Code chooses the recommended model for your account",
    contextWindow: getModelContextWindow("default", "claude"),
  },
  {
    id: "best",
    name: "Best",
    description: "Highest-capability Claude Code alias for complex work",
    contextWindow: getModelContextWindow("best", "claude"),
  },
  {
    id: "sonnet",
    name: "Sonnet",
    description: "Standard-context Sonnet for everyday coding tasks",
    contextWindow: getModelContextWindow("sonnet", "claude"),
  },
  {
    id: "sonnet[1m]",
    name: "Sonnet 1M",
    description: "Sonnet with 1M context for long sessions and large codebases",
    contextWindow: getModelContextWindow("sonnet[1m]", "claude"),
  },
  {
    id: "opus",
    name: "Opus",
    description: "Standard-context Opus for the most demanding reasoning",
    contextWindow: getModelContextWindow("opus", "claude"),
  },
  {
    id: "opus[1m]",
    name: "Opus 1M",
    description: "Opus with 1M context for the largest working sets",
    contextWindow: getModelContextWindow("opus[1m]", "claude"),
  },
  {
    id: "haiku",
    name: "Haiku",
    description: "Fastest model for simple tasks",
    contextWindow: getModelContextWindow("haiku", "claude"),
  },
  {
    id: "opusplan",
    name: "Opus Plan",
    description: "Uses Opus for planning, then Sonnet for execution",
    contextWindow: getModelContextWindow("opus", "claude"),
  },
];

function enrichClaudeModel(model: ModelInfo): ModelInfo {
  return {
    ...model,
    contextWindow: model.contextWindow ?? getModelContextWindow(model.id, "claude"),
  };
}

function mergeClaudeModels(models: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();

  for (const model of CLAUDE_MODELS_FALLBACK) {
    byId.set(model.id, enrichClaudeModel(model));
  }

  for (const model of models) {
    byId.set(model.id, enrichClaudeModel(model));
  }

  const orderedIds = [
    ...CLAUDE_MODELS_FALLBACK.map((model) => model.id),
    ...models.map((model) => model.id),
  ];

  return [...new Set(orderedIds)]
    .map((id) => byId.get(id))
    .filter((model): model is ModelInfo => model !== undefined);
}

/** Cached models from SDK probe */
let cachedModels: ModelInfo[] | null = null;

/** Promise for in-flight probe (to avoid duplicate probes) */
let probePromise: Promise<ModelInfo[]> | null = null;

/**
 * Claude provider implementation using @anthropic-ai/claude-agent-sdk.
 *
 * This class wraps the SDK's query() function and provides:
 * - MessageQueue for queuing user messages
 * - AbortController for cancellation
 * - Tool approval callbacks
 */
export class ClaudeProvider implements AgentProvider {
  readonly name: ProviderName = "claude";
  readonly displayName: string = "Claude";
  readonly supportsPermissionMode = true;
  readonly supportsThinkingToggle = true;
  readonly supportsSlashCommands = true;

  /**
   * Check if Claude SDK is available.
   * Since we bundle the SDK, this is always true.
   */
  async isInstalled(): Promise<boolean> {
    return true;
  }

  /**
   * Check if Claude is authenticated.
   * Returns true if ANTHROPIC_API_KEY is set or OAuth credentials exist.
   */
  async isAuthenticated(): Promise<boolean> {
    const authStatus = await this.getAuthStatus();
    return authStatus.authenticated;
  }

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
  async getAuthStatus(): Promise<AuthStatus> {
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

    return { installed: true, authenticated, enabled: authenticated, expiresAt };
  }

  /**
   * Ask the Claude CLI directly whether it is logged in. Returns null (so callers
   * fall through to credential inspection) when the CLI doesn't support
   * `auth status`, times out, or emits non-JSON output — those are expected, not
   * failures worth surfacing.
   */
  private async getCliAuthStatus(): Promise<AuthStatus | null> {
    try {
      const cliInfo = detectClaudeCli();
      const claudePath = cliInfo.path ?? "claude";
      const { stdout } = await execFileAsync(claudePath, ["auth", "status"], {
        encoding: "utf-8",
        timeout: 5000,
      });

      const parsed = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
      if (typeof parsed.loggedIn !== "boolean") {
        return null;
      }

      return {
        installed: true,
        authenticated: parsed.loggedIn,
        enabled: parsed.loggedIn,
        user: parsed.email ? { email: parsed.email } : undefined,
      };
    } catch (error) {
      console.debug("[Claude] `claude auth status` unavailable, falling back:", error);
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
  } | null> {
    try {
      let raw: string;
      if (process.platform === "darwin") {
        const service = process.env.CLAUDE_CODE_KEYCHAIN_SERVICE ?? CLAUDE_CODE_KEYCHAIN_SERVICE;
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
        claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
      };
      return parsed.claudeAiOauth ?? null;
    } catch (error) {
      console.debug("[Claude] No readable OAuth credentials:", error);
      return null;
    }
  }

  /**
   * Check if Claude CLI is installed.
   * Uses detectClaudeCli() which checks PATH and common installation locations.
   */
  private async isClaudeCliInstalled(): Promise<boolean> {
    const cliInfo = detectClaudeCli();
    return cliInfo.found;
  }

  /**
   * Get available Claude models.
   * Fetches dynamically from SDK via a probe session, with caching.
   * Falls back to static list if probe fails or user is not authenticated.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    // Return cached models if available
    if (cachedModels) {
      return cachedModels;
    }

    // Check if user is authenticated before trying to probe
    const authStatus = await this.getAuthStatus();
    if (!authStatus.authenticated) {
      return CLAUDE_MODELS_FALLBACK;
    }

    // If probe is already in progress, wait for it
    if (probePromise) {
      return probePromise;
    }

    // Start a new probe
    probePromise = this.probeModels();
    try {
      const models = await probePromise;
      cachedModels = mergeClaudeModels(models);
      return cachedModels;
    } catch (error) {
      console.warn("[Claude] Failed to probe models, using fallback:", error);
      return CLAUDE_MODELS_FALLBACK;
    } finally {
      probePromise = null;
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

  protected async readClaudeCodeOAuthAccessToken(): Promise<string> {
    if (process.platform !== "darwin") {
      throw new Error("Claude OAuth usage limits require macOS Keychain credentials.");
    }

    const service = process.env.CLAUDE_CODE_KEYCHAIN_SERVICE ?? CLAUDE_CODE_KEYCHAIN_SERVICE;
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      { timeout: USAGE_LIMITS_TIMEOUT_MS },
    );

    let credentials: { claudeAiOauth?: { accessToken?: unknown } };
    try {
      credentials = JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: unknown } };
    } catch {
      throw new Error("Claude Code Keychain credentials were not valid JSON.");
    }

    const accessToken = credentials.claudeAiOauth?.accessToken;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new Error(
        "Claude Code Keychain credentials did not contain claudeAiOauth.accessToken.",
      );
    }

    return accessToken;
  }

  protected async fetchClaudeOAuthUsage(accessToken: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), USAGE_LIMITS_TIMEOUT_MS);

    try {
      const response = await fetch(process.env.CLAUDE_OAUTH_USAGE_URL ?? CLAUDE_OAUTH_USAGE_URL, {
        headers: {
          accept: "application/json",
          "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
          authorization: `Bearer ${accessToken}`,
          "user-agent": "scholaraio-hub-claude-usage",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Claude OAuth usage API returned HTTP ${response.status}.`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get filtered environment variables for child processes.
   * Subclasses can override to inject custom env vars (e.g., ANTHROPIC_BASE_URL).
   */
  protected getEnv(): Record<string, string | undefined> {
    return filterEnvForChildProcess();
  }

  /**
   * Build the systemPrompt option for the SDK query.
   * Default: use the full claude_code preset. Subclasses (e.g., Ollama) can
   * override to provide a simpler prompt that smaller models can follow.
   */
  protected getSystemPrompt(
    globalInstructions?: string,
  ): string | { type: "preset"; preset: "claude_code"; append?: string } | undefined {
    return globalInstructions
      ? {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: globalInstructions,
        }
      : { type: "preset" as const, preset: "claude_code" as const };
  }

  /**
   * Probe for available models by starting a minimal session.
   * The session doesn't send any messages - it just calls supportedModels()
   * on the SDK query and then aborts.
   */
  private async probeModels(): Promise<ModelInfo[]> {
    const abortController = new AbortController();

    // Generator that waits indefinitely — keeps the SDK process alive
    // while we query supportedModels() from the initialization handshake.
    // Resolves (rather than rejects) on abort to avoid unhandled rejections.
    async function* waitForever(): AsyncGenerator<never> {
      await new Promise<never>((resolve) => {
        abortController.signal.addEventListener("abort", () => resolve(undefined as never));
      });
    }

    try {
      const sdkQuery = query({
        prompt: waitForever(),
        options: {
          cwd: homedir(),
          abortController,
          permissionMode: "default",
          persistSession: false,
          pathToClaudeCodeExecutable: resolveLocalClaudeCodeExecutable(),
          env: this.getEnv(),
        },
      });

      // The SDK's internal readMessages loop must be running for
      // the initialize control_response to be processed. Start
      // consuming the async iterator in the background.
      const drain = (async () => {
        try {
          for await (const _ of sdkQuery) {
            // drain
          }
        } catch {
          // Expected — abort causes an error
        }
      })();

      // supportedModels() resolves once the initialize handshake completes.
      // Race against a timeout in case the process hangs.
      const models = await Promise.race([
        sdkQuery.supportedModels(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Model probe timed out")), 15000),
        ),
      ]);

      return mergeClaudeModels(
        models.map((m) => ({
          id: m.value,
          name: m.displayName,
          description: m.description,
        })),
      );
    } finally {
      abortController.abort();
    }
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
          console.log(`[canUseTool] Called for tool: ${toolName}`);
          const result = await onToolApproval(toolName, input, opts);
          console.log(`[canUseTool] Result for ${toolName}: ${result.behavior}`);
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

    // Create spawn function: local wrapper for liveness checks
    let spawnClaudeCodeProcess:
      | ((opts: import("@anthropic-ai/claude-agent-sdk").SpawnOptions) => SpawnedProcess)
      | undefined;
    let capturedProcess: SpawnedProcess | null = null;

    if (USE_SPAWN_WRAPPER) {
      // Local spawn wrapper: delegates to child_process.spawn but captures the
      // SpawnedProcess reference so we can check liveness (exitCode) later.
      spawnClaudeCodeProcess = (spawnOpts) => {
        const proc = spawn(spawnOpts.command, spawnOpts.args, {
          cwd: spawnOpts.cwd,
          env: spawnOpts.env as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        // Wire up abort signal → SIGTERM, matching remote-spawn behavior
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
    }

    // Create the SDK query with our message generator
    let sdkQuery: Query;
    try {
      sdkQuery = query({
        prompt: queue.generator(),
        options: {
          cwd: options.cwd,
          resume: options.resumeSessionId,
          abortController,
          // Pass permission mode to SDK for system prompt configuration.
          // However, for "bypassPermissions" we pass "default" to the SDK so it always
          // calls our canUseTool callback - we handle the bypass logic ourselves to
          // allow exceptions (e.g., always prompting for AskUserQuestion/ExitPlanMode).
          permissionMode:
            options.permissionMode === "bypassPermissions"
              ? "default"
              : (options.permissionMode ?? "default"),
          canUseTool,
          systemPrompt: this.getSystemPrompt(options.globalInstructions),
          settingSources: ["user", "project", "local"],
          includePartialMessages: true,
          // Model, thinking, and effort options
          model: options.model,
          thinking: options.thinking,
          effort: options.effort,
          // Filter env to exclude npm_*, scholaraio-hub specific, and other irrelevant vars
          env: this.getEnv(),
          pathToClaudeCodeExecutable: resolveLocalClaudeCodeExecutable(),
          // Remote execution via SSH
          spawnClaudeCodeProcess,
        },
      });
    } catch (error) {
      // Handle common SDK initialization errors
      if (error instanceof Error) {
        if (error.message.includes("Claude Code executable not found")) {
          throw new Error(
            "Claude CLI not installed. Run: curl -fsSL https://claude.ai/install.sh | bash",
          );
        }
        if (error.message.includes("SPAWN") || error.message.includes("spawn")) {
          throw new Error(`Failed to spawn Claude CLI process: ${error.message}`);
        }
      }
      throw error;
    }

    // Wrap the iterator to convert SDK message types
    const wrappedIterator = this.wrapIterator(sdkQuery);

    return {
      iterator: wrappedIterator,
      queue,
      abort: () => abortController.abort(),
      isProcessAlive: USE_SPAWN_WRAPPER
        ? () =>
            capturedProcess !== null && capturedProcess.exitCode === null && !capturedProcess.killed
        : undefined,
      get pid() {
        return (capturedProcess as ChildProcess | null)?.pid;
      },
      setMaxThinkingTokens: (tokens: number | null) => sdkQuery.setMaxThinkingTokens(tokens),
      interrupt: () => sdkQuery.interrupt(),
      supportedModels: async (): Promise<ModelInfo[]> => {
        const models = await sdkQuery.supportedModels();
        // Map SDK ModelInfo (value, displayName, description) to our ModelInfo (id, name, description)
        const mappedModels = mergeClaudeModels(
          models.map((m) => ({
            id: m.value,
            name: m.displayName,
            description: m.description,
          })),
        );
        // Update cache for future getAvailableModels() calls
        cachedModels = mappedModels;
        return mappedModels;
      },
      supportedCommands: async (): Promise<SlashCommand[]> => {
        const commands = await sdkQuery.supportedCommands();
        // Map SDK SlashCommand to our SlashCommand (same fields, just normalize)
        return commands.map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.argumentHint || undefined,
        }));
      },
      setModel: (model?: string) => sdkQuery.setModel(model),
    };
  }

  /**
   * Wrap the SDK iterator to convert message types.
   * The SDK emits its own message types which we convert to our internal SDKMessage type.
   */
  private async *wrapIterator(
    iterator: AsyncIterable<AgentSDKMessage>,
  ): AsyncIterableIterator<SDKMessage> {
    let sessionId = "unknown";

    try {
      for await (const message of iterator) {
        // Log raw SDK message for analysis (if LOG_SDK_MESSAGES=true)
        sessionId = (message as { session_id?: string }).session_id ?? sessionId;
        logSDKMessage(sessionId, message, { provider: "claude" });

        const converted = this.convertMessage(message);
        yield converted;
      }
    } catch (error) {
      // Handle abort errors gracefully
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      // Re-throw process termination errors for Process to handle
      // These include: "ProcessTransport is not ready for writing"
      throw error;
    }
  }

  /**
   * Convert an SDK message to our internal SDKMessage format.
   *
   * We pass through all fields from the SDK without stripping.
   * This preserves debugging info, DAG structure, and metadata.
   */
  private convertMessage(message: AgentSDKMessage): SDKMessage {
    // Pass through all fields, only normalize content blocks
    const sdkMessage = message as unknown as SDKMessage;

    // For messages with content, normalize the content blocks
    if (sdkMessage.message?.content) {
      return {
        ...sdkMessage,
        message: {
          ...sdkMessage.message,
          content: this.normalizeContent(sdkMessage.message.content),
        },
      };
    }

    // Pass through as-is for messages without content
    return sdkMessage;
  }

  /**
   * Normalize content to ensure consistent format.
   * Preserves all fields, only converts strings to text blocks.
   */
  private normalizeContent(content: string | ContentBlock[] | unknown): string | ContentBlock[] {
    // String content stays as string
    if (typeof content === "string") {
      return content;
    }

    // Array content - normalize each block
    if (Array.isArray(content)) {
      return content.map((block): ContentBlock => {
        if (typeof block === "string") {
          return { type: "text", text: block };
        }
        // Pass through all block fields - don't strip anything
        return block as ContentBlock;
      });
    }

    // Unknown content type - stringify for safety
    return String(content);
  }
}

/**
 * Default Claude provider instance.
 * Can be imported for convenience or instantiated directly.
 */
export const claudeProvider = new ClaudeProvider();
