import { createApp } from "../../src/app.js";
import { createServices } from "../../src/container.js";
import type { LibraryClient } from "../../src/lib/LibraryClient.js";
import { ProviderRegistry } from "../../src/providers/ProviderRegistry.js";
import type { AgentProvider } from "../../src/providers/types.js";
import type { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import { skillsDirectory } from "../../src/skills/skillsDirectory.js";
import { createScriptedProvider } from "./scriptedProvider.js";

export interface TestAppOptions {
  dataDir: string;
  library: LibraryClient;
  /** 唯一启用的 Provider（也是默认 Provider）；未给出时用脚本化的假 Provider。 */
  provider?: AgentProvider;
  /** 多个启用的 Provider，取代 `provider`。 */
  providers?: AgentProvider[];
  scholaraioSkillsDir?: string;
  serverSettingsService?: ServerSettingsService;
  idleTimeoutMs?: number;
  frontendDistPath?: string;
  allowedHosts?: string;
  profile?: string;
}

/** 像入口那样组装服务和应用：`ready` 完成后再发请求，`close` 释放全部服务。 */
export function createTestApp(options: TestAppOptions) {
  const services = createServices({
    dataDir: options.dataDir,
    library: options.library,
    providers: new ProviderRegistry(
      options.providers ?? [options.provider ?? createScriptedProvider()],
    ),
    skillsDir: options.scholaraioSkillsDir ?? skillsDirectory(options.dataDir),
    settings: options.serverSettingsService,
    idleTimeoutMs: options.idleTimeoutMs,
  });
  const ready = services.start();
  const app = createApp(services, {
    frontendDistPath: options.frontendDistPath,
    allowedHosts: options.allowedHosts,
    profile: options.profile,
  });
  return {
    app,
    sessions: services.sessions,
    ready,
    close: async () => {
      await ready;
      await services.close();
    },
  };
}
