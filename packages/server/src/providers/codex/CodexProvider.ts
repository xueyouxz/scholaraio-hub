/**
 * The Codex provider: what the Codex CLI can tell about itself (install, login,
 * models, skills, usage limits), forking a thread, and starting a session.
 * Each query runs on a short-lived `codex app-server`; a session gets its own
 * (see CodexSession).
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ATTACHMENT_LIMITS,
  type ModelInfo,
  type ProviderUsageLimits,
  type SlashCommand,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../../logging/logger.js";
import { withTimeout } from "../../utils/timeout.js";
import { type AgentLibrary, agentEnv } from "../agent-env.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ForkSessionOptions,
  ProviderCapabilities,
  StartSessionOptions,
} from "../types.js";
import { normalizeCodexRateLimits } from "../usage-limits.js";
import { CodexAppServerClient } from "./CodexAppServerClient.js";
import { CodexSession } from "./CodexSession.js";
import { codexVersion, findCodexCli } from "./cli.js";
import { listCodexSkills, toCodexSkillCommand } from "./skills.js";

const log = () => loggerFor("codex-provider");

export interface CodexProviderConfig {
  /** Path to codex binary (auto-detected if not specified); tests point it at a fake. */
  codexPath?: string;
  /** agent 中 `scholaraio` CLI 使用的文献库。 */
  agentLibrary?: AgentLibrary;
}

const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
const APP_SERVER_QUERY_TIMEOUT_MS = 8000;

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

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  readonly displayName = "Codex";
  readonly capabilities: ProviderCapabilities = {
    // Codex's approval presets; each is the sandbox codexThreadPolicy() gives that mode.
    permissionModes: [
      {
        id: "plan",
        label: "Read Only",
        description:
          "Codex can read files in the current workspace. Approval is required to edit files or access the internet.",
      },
      {
        id: "default",
        label: "Default",
        description:
          "Codex can read and edit files in the current workspace, and run commands. Approval is required to access the internet or edit other files.",
      },
      {
        id: "bypassPermissions",
        label: "Full Access",
        description:
          "Codex can edit files outside this workspace and access the internet without asking for approval.",
      },
    ],
    // Codex has no thinking switch: reasoning effort alone ("none" turns it off).
    thinkingModes: [],
    slashCommands: "anywhere",
    contextUsage: "remaining",
    attachments: ATTACHMENT_LIMITS,
  };

  private modelCache: { models: ModelInfo[]; expiresAt: number } | null = null;
  /** The CLI once found; looking it up spawns `which` and `--version`. */
  private executable: string | undefined;

  constructor(private readonly config: CodexProviderConfig = {}) {}

  /** The Codex CLI that runs here — the configured one, else one found — or null. */
  private async codexCommand(): Promise<string | null> {
    if (this.executable) return this.executable;
    const found = this.config.codexPath
      ? ((await codexVersion(this.config.codexPath)) && this.config.codexPath) || null
      : ((await findCodexCli())?.path ?? null);
    if (found) this.executable = found;
    return found;
  }

  /**
   * What to spawn: a configured path is used as given (and fails as given);
   * otherwise the CLI found here, or plain `codex` for the spawn error to name.
   */
  private async launchCommand(): Promise<string> {
    return this.config.codexPath ?? (await this.codexCommand()) ?? "codex";
  }

  /** The environment every Codex process gets: the user's, minus the Hub's, plus the library CLI. */
  private env(): NodeJS.ProcessEnv {
    return agentEnv(this.config.agentLibrary);
  }

  /** Run `use` against a fresh, initialized app-server in `cwd`; it is closed afterwards. */
  private async withAppServer<T>(
    cwd: string,
    use: (client: CodexAppServerClient) => Promise<T>,
  ): Promise<T> {
    const client = new CodexAppServerClient(await this.launchCommand(), cwd, this.env());
    try {
      await client.open();
      return await use(client);
    } finally {
      client.close();
    }
  }

  /**
   * Get detailed authentication status.
   * Ask the executable itself; a path on disk does not prove availability or login.
   */
  async getAuthStatus(): Promise<AuthStatus> {
    const command = await this.codexCommand();
    if (!command) return { installed: false, authenticated: false, enabled: false };
    const env = this.env();
    if (
      ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"].some((name) =>
        Boolean(env[name]?.trim()),
      )
    )
      return { installed: true, authenticated: true, enabled: true };
    try {
      await promisify(execFile)(command, ["login", "status"], { timeout: 10000, env });
    } catch {
      // The login status command communicates logged-out state with its exit code.
      return { installed: true, authenticated: false, enabled: false };
    }
    // Logged in with ChatGPT: the plan and email ride on the stored id token.
    const account = await this.readChatGptAccount();
    return {
      installed: true,
      authenticated: true,
      enabled: true,
      user: account?.email ? { email: account.email } : undefined,
      plan: account?.plan,
    };
  }

  /**
   * The ChatGPT account Codex is logged in with, from the claims of the id
   * token in `$CODEX_HOME/auth.json`. Null for API-key logins, or when the
   * file is missing or unreadable — the login itself was already confirmed.
   */
  private async readChatGptAccount(): Promise<{ email?: string; plan?: string } | null> {
    const home = this.env().CODEX_HOME || join(homedir(), ".codex");
    try {
      const auth = JSON.parse(await readFile(join(home, "auth.json"), "utf-8")) as {
        auth_mode?: string;
        tokens?: { id_token?: string };
      };
      const payload = auth.tokens?.id_token?.split(".")[1];
      if (!payload || (auth.auth_mode && auth.auth_mode !== "chatgpt")) return null;
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
        email?: string;
        "https://api.openai.com/auth"?: { chatgpt_plan_type?: string };
      };
      return {
        email: claims.email,
        plan: claims["https://api.openai.com/auth"]?.chatgpt_plan_type || undefined,
      };
    } catch (error) {
      log().debug({ err: error }, "Cannot read the ChatGPT account from auth.json");
      return null;
    }
  }

  /**
   * The models app-server `model/list` offers. No list means no models are
   * offered; a failed query is retried next time rather than cached as none.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.modelCache && this.modelCache.expiresAt > now) return this.modelCache.models;
    if (!(await this.codexCommand())) return [];
    try {
      const listed = await this.withAppServer(process.cwd(), (client) =>
        withTimeout(
          client.request<{ data?: unknown[] }>("model/list", { limit: 100 }),
          APP_SERVER_QUERY_TIMEOUT_MS,
          "Timed out querying Codex app-server model list",
        ),
      );
      const models = toCodexModels(
        (listed.data ?? []).filter(
          (item): item is AppServerModel =>
            Boolean(item) && typeof (item as AppServerModel).id === "string",
        ),
      );
      if (models.length > 0) this.modelCache = { models, expiresAt: now + MODEL_CACHE_TTL_MS };
      return models;
    } catch (error) {
      log().warn({ err: error }, "Failed to query Codex app-server model list; offering none");
      return [];
    }
  }

  /**
   * Skills Codex offers in `cwd`, as app-server `skills/list` reports them.
   * Codex invokes a skill by mentioning `$name` anywhere in the message.
   */
  async listCommands(cwd: string): Promise<SlashCommand[]> {
    const skills = await this.withAppServer(cwd, (client) =>
      withTimeout(
        listCodexSkills(client, cwd),
        APP_SERVER_QUERY_TIMEOUT_MS,
        "Timed out listing Codex skills",
      ),
    );
    return skills.map(toCodexSkillCommand);
  }

  /**
   * Fork with app-server `thread/fork`, then drop the trailing turns with
   * `thread/rollback` (the pair Yep Anywhere uses). Local file changes stay.
   */
  async forkSession({ sessionId, cwd, dropTurns }: ForkSessionOptions): Promise<string> {
    return this.withAppServer(cwd, async (client) => {
      const fork = await client.request<{ thread?: { id?: string } }>("thread/fork", {
        threadId: sessionId,
        cwd,
      });
      const threadId = fork.thread?.id;
      if (!threadId) throw new Error("Codex thread/fork did not return a new session");
      if (dropTurns > 0) await client.request("thread/rollback", { threadId, numTurns: dropTurns });
      return threadId;
    });
  }

  async getUsageLimits(): Promise<ProviderUsageLimits> {
    const payload = await this.withAppServer(process.cwd(), (client) =>
      withTimeout(
        client.request<unknown>("account/rateLimits/read"),
        APP_SERVER_QUERY_TIMEOUT_MS,
        "Timed out querying Codex usage limits",
      ),
    );
    return (
      normalizeCodexRateLimits(this.name, payload, "codex-app-server") ?? {
        provider: this.name,
        available: false,
        windows: [],
        error: "Codex app-server did not return usage limit windows.",
      }
    );
  }

  async startSession(options: StartSessionOptions): Promise<AgentSession> {
    return new CodexSession(options, await this.launchCommand(), this.env());
  }
}

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
