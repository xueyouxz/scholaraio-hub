/**
 * The Claude provider: what the Claude Code CLI can tell about itself (login,
 * models, commands, usage limits), forking a session, and starting one (see
 * ClaudeSession). Locating and asking the CLI itself is in cli.ts.
 */

import { homedir } from "node:os";
import {
  type Query,
  type ModelInfo as SdkModelInfo,
  forkSession,
  getSessionMessages,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ATTACHMENT_LIMITS,
  type ModelInfo,
  type ProviderUsageLimits,
  type SlashCommand,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../../logging/logger.js";
import { AsyncCache } from "../../utils/async-cache.js";
import { outboundFetch } from "../../utils/outboundFetch.js";
import { withTimeout } from "../../utils/timeout.js";
import { type AgentLibrary, agentEnv } from "../agent-env.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ForkSessionOptions,
  ProviderCapabilities,
  ProviderName,
  StartSessionOptions,
} from "../types.js";
import { normalizeClaudeOAuthUsage } from "../usage-limits.js";
import { ClaudeSession } from "./ClaudeSession.js";
import {
  canRunClaude,
  claudeAuthStatus,
  readClaudeOAuthCredentials,
  resolveLocalClaudeCodeExecutable,
} from "./cli.js";

const log = () => loggerFor("claude-provider");

const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const USAGE_LIMITS_TIMEOUT_MS = 8000;

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
/** How long a login check stands: each one runs the CLI twice. */
const AUTH_STATUS_TTL_MS = 30_000;
/** How long the probed model list stands; a CLI update or new login can change it. */
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
/** After a failed probe, how long to offer no models before probing again (each costs up to 15s). */
const PROBE_RETRY_MS = 60_000;

export class ClaudeProvider implements AgentProvider {
  constructor(private readonly config: ClaudeProviderConfig = {}) {}

  private readonly authStatus = new AsyncCache<"status", AuthStatus>({
    ttlMs: AUTH_STATUS_TTL_MS,
  });
  /** An empty list (no login yet) is asked again; a failed probe only after a while. */
  private readonly models = new AsyncCache<"models", ModelInfo[]>({
    ttlMs: MODEL_CACHE_TTL_MS,
    failureTtlMs: PROBE_RETRY_MS,
    keep: (models) => models.length > 0,
  });
  private readonly commands = new AsyncCache<string, SlashCommand[]>({
    ttlMs: COMMAND_CACHE_TTL_MS,
  });

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
    return this.authStatus.get("status", () => this.readAuthStatus());
  }

  private async readAuthStatus(): Promise<AuthStatus> {
    const executable = this.executable();
    if (!executable || !(await canRunClaude(executable))) {
      return { installed: false, authenticated: false, enabled: false };
    }

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { installed: true, authenticated: true, enabled: true };
    }

    const cliAuthStatus = await claudeAuthStatus(executable);
    if (cliAuthStatus) {
      return cliAuthStatus;
    }

    const oauth = await readClaudeOAuthCredentials(this.config.keychainService);
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
   * The models the CLI offers, from a probe session. Cached for a while; after
   * a failed probe none are offered until the next retry, so a broken CLI does
   * not stall every caller for the probe timeout.
   */
  getAvailableModels(): Promise<ModelInfo[]> {
    return this.models
      .get("models", async () => {
        // An unauthenticated CLI never finishes its handshake; it has no models to offer.
        if (!(await this.getAuthStatus()).authenticated) return [];
        try {
          return await this.probeModels();
        } catch (error) {
          log().warn({ err: error }, "Failed to probe models; none offered until the next retry");
          throw error;
        }
      })
      .catch(() => []);
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
    const credentials = await readClaudeOAuthCredentials(this.config.keychainService);
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

  /** The Claude Code executable to run: the configured one, else the one found here. */
  private executable(): string | undefined {
    return resolveLocalClaudeCodeExecutable(this.config.executable);
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
          pathToClaudeCodeExecutable: this.executable(),
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
  listCommands(cwd: string): Promise<SlashCommand[]> {
    return this.commands.get(cwd, async () =>
      (await this.probe(cwd, (sdkQuery) => sdkQuery.supportedCommands(), "Command")).map(
        toClaudeCommand,
      ),
    );
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

  async startSession(options: StartSessionOptions): Promise<AgentSession> {
    return new ClaudeSession(options, { executable: this.executable(), env: this.getEnv() });
  }
}
