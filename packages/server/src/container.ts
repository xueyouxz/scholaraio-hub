import type { LibraryClient } from "./lib/LibraryClient.js";
import type { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import { ServerSettingsService } from "./services/ServerSettingsService.js";
import { SessionService } from "./sessions/SessionService.js";
import { SessionStore } from "./sessions/SessionStore.js";

export interface ServiceOptions {
  dataDir: string;
  /** 文献服务的客户端；服务本身由启动器运行。 */
  library: LibraryClient;
  /** 已启用的 Provider。 */
  providers: ProviderRegistry;
  /** 科研技能目录，作为命令提供并展开进提示词。 */
  skillsDir: string;
  idleTimeoutMs?: number;
  /** 应用设置；未给出时使用数据目录下的设置文件。 */
  settings?: ServerSettingsService;
}

/** 组装根：创建一次的各项服务，及其启动与关闭。 */
export interface Services {
  dataDir: string;
  library: LibraryClient;
  providers: ProviderRegistry;
  skillsDir: string;
  store: SessionStore;
  sessions: SessionService;
  settings: ServerSettingsService;
  usage: ProviderUsageLimitService;
  /** 读入持久化状态；完成前不接收请求。 */
  start(): Promise<void>;
  /** 按创建的逆序释放：先停会话与 agent 进程，再等设置写完。 */
  close(): Promise<void>;
}

/** 创建 server 的全部服务。只构造对象，不读写磁盘、不启动进程。 */
export function createServices(options: ServiceOptions): Services {
  const { dataDir, library, providers, skillsDir } = options;
  const settings = options.settings ?? new ServerSettingsService({ dataDir });
  const usage = new ProviderUsageLimitService();
  const store = new SessionStore(dataDir);
  const sessions = new SessionService(store, library, {
    providers,
    idleTimeoutMs: options.idleTimeoutMs,
    skillsDir,
    onUsageLimits: (limits) => usage.record(limits),
  });
  return {
    dataDir,
    library,
    providers,
    skillsDir,
    store,
    sessions,
    settings,
    usage,
    async start() {
      await Promise.all([settings.initialize(), store.initialize()]);
    },
    async close() {
      await sessions.close();
      await settings.close();
    },
  };
}
