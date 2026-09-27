import { DEFAULT_PROVIDER, type ProviderName } from "@scholaraio-hub/shared";
import type { AgentLibrary } from "./agent-env.js";
import { ClaudeProvider, type ClaudeProviderConfig } from "./claude/ClaudeProvider.js";
import { CodexProvider } from "./codex/CodexProvider.js";
import type { AgentProvider } from "./types.js";

/** 表示请求的 Provider 未启用（`ENABLED_PROVIDERS`）或不存在。 */
export class ProviderUnavailableError extends Error {
  constructor(readonly provider: string) {
    super(`Provider ${provider} is not enabled on this Hub.`);
  }
}

/** 构造各 Provider 所需的配置。 */
export interface ProviderSettings {
  /** `ENABLED_PROVIDERS`：只运行、只展示这些 Provider。 */
  enabled: readonly ProviderName[];
  claude?: Omit<ClaudeProviderConfig, "agentLibrary">;
  /** agent 中 `scholaraio` CLI 使用的文献库。 */
  agentLibrary?: AgentLibrary;
}

/**
 * 本服务运行的 Provider，组装时创建一次。未启用的 Provider 不展示、不能新建会话，
 * 也不能继续运行已有会话；所有取用 Provider 的地方都经过这里。
 */
export class ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderName, AgentProvider>;

  constructor(providers: readonly AgentProvider[]) {
    if (providers.length === 0) throw new Error("At least one provider must be enabled.");
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  /** 按配置创建已启用的 Claude 与 Codex Provider。 */
  static create(settings: ProviderSettings): ProviderRegistry {
    const { agentLibrary } = settings;
    const all: Record<ProviderName, () => AgentProvider> = {
      claude: () => new ClaudeProvider({ ...settings.claude, agentLibrary }),
      codex: () => new CodexProvider({ agentLibrary }),
    };
    return new ProviderRegistry(settings.enabled.map((name) => all[name]()));
  }

  /** 已启用的 Provider，按启用顺序。 */
  list(): AgentProvider[] {
    return [...this.providers.values()];
  }

  /** 会话未指定 Provider 时使用的 Provider：启用时为 Claude，否则为第一个启用的。 */
  get defaultProvider(): AgentProvider {
    return this.providers.get(DEFAULT_PROVIDER) ?? (this.list()[0] as AgentProvider);
  }

  /** 按名称取 Provider；未指定时取默认 Provider，未启用时抛出 `ProviderUnavailableError`。 */
  get(name?: ProviderName): AgentProvider {
    if (!name) return this.defaultProvider;
    const provider = this.providers.get(name);
    if (!provider) throw new ProviderUnavailableError(name);
    return provider;
  }
}
