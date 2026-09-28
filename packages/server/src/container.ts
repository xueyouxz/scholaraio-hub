import { homedir } from "node:os";
import type { LibraryClient } from "./lib/LibraryClient.js";
import { HistoryWatcher } from "./projects/HistoryWatcher.js";
import { ProjectCatalog } from "./projects/ProjectCatalog.js";
import { DirectoryRules } from "./projects/directories.js";
import type { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { HubEvents } from "./services/HubEvents.js";
import { ProviderUsageLimitService } from "./services/ProviderUsageLimitService.js";
import { ServerSettingsService } from "./services/ServerSettingsService.js";
import { SessionAttachments } from "./sessions/SessionAttachments.js";
import { SessionFiles } from "./sessions/SessionFiles.js";
import { SessionService } from "./sessions/SessionService.js";
import { SessionStore } from "./sessions/SessionStore.js";
import { Supervisor } from "./supervisor/Supervisor.js";

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
  /** 哪些工作目录不算项目；未给出时按本机主目录与临时目录判断。 */
  directories?: DirectoryRules;
}

/** 组装根：创建一次的各项服务，及其启动与关闭。 */
export interface Services {
  dataDir: string;
  library: LibraryClient;
  providers: ProviderRegistry;
  skillsDir: string;
  store: SessionStore;
  supervisor: Supervisor;
  sessions: SessionService;
  attachments: SessionAttachments;
  files: SessionFiles;
  settings: ServerSettingsService;
  usage: ProviderUsageLimitService;
  /** 各 Provider 自己保存的会话，按项目分组。 */
  catalog: ProjectCatalog;
  /** 推送给打开页面的变更。 */
  events: HubEvents;
  /** 读入持久化状态；完成前不接收请求。 */
  start(): Promise<void>;
  /** 按创建的逆序释放：先结束会话的当前轮，再停 agent 进程，最后等会话与设置写完。 */
  close(): Promise<void>;
}

/** 创建 server 的全部服务。只构造对象，不读写磁盘、不启动进程。 */
export function createServices(options: ServiceOptions): Services {
  const { dataDir, library, providers, skillsDir } = options;
  const settings = options.settings ?? new ServerSettingsService({ dataDir });
  const usage = new ProviderUsageLimitService();
  const store = new SessionStore(dataDir);
  const supervisor = new Supervisor({ providers, idleTimeoutMs: options.idleTimeoutMs });
  const attachments = new SessionAttachments(dataDir);
  const events = new HubEvents();
  // A provider writing a session file: the Hub's own sessions, or a CLI in a terminal.
  const history = new HistoryWatcher({
    providers,
    owns: (provider, id) => supervisor.runs(provider, id),
  });
  const catalog: ProjectCatalog = new ProjectCatalog({
    providers,
    dataDir,
    rules: options.directories ?? new DirectoryRules({ home: homedir(), dataDir }),
    isExternal: (provider, id) => history.isExternal(provider, id),
    activity: (key) => sessions.activity(key),
    archived: (key) => sessions.archived(key),
    titleOf: (key) => store.find(key)?.title,
  });
  const sessions: SessionService = new SessionService({
    store,
    library,
    providers,
    supervisor,
    attachments,
    catalog,
    events,
    dataDir,
    skillsDir,
  });
  const files = new SessionFiles((id) => sessions.workingDirectory(id));
  history.subscribe(() => {
    catalog.invalidate();
    events.publish({ type: "sessions" });
  });
  // Providers report usage windows in passing; the usage display keeps them.
  supervisor.subscribe((_, event) => {
    if (event.type === "agent" && event.event.type === "rate-limit")
      usage.record(event.event.limits);
  });
  return {
    dataDir,
    library,
    providers,
    skillsDir,
    store,
    supervisor,
    sessions,
    attachments,
    files,
    settings,
    usage,
    catalog,
    events,
    async start() {
      await Promise.all([settings.initialize(), store.initialize(), catalog.initialize()]);
      await history.start();
    },
    async close() {
      history.close();
      events.close();
      await sessions.close();
      await supervisor.close();
      await Promise.all([store.flush(), settings.close(), catalog.close()]);
    },
  };
}
