# 架构

面向贡献者的整体说明。使用方式见 [README](../README.md)，开发流程见
[CONTRIBUTING](../CONTRIBUTING.md)。写代码时的约束以 `.claude/rules/` 为准，这里只讲结构和原因。

## 职责

`packages/client` / `server` / `cli` / `shared` 四个 TypeScript 包，加同仓库的 Python 包 `packages/scholaraio`。

- **client**：`app/` 是文献库、阅读器、会话、设置的导航外壳；`features/library` 负责导入、检索和阅读，
  `features/session` 负责会话显示与输入；`shared/components/Markdown.tsx` 统一 Streamdown 渲染。
- **server/routes**：校验、响应、二进制文件流和订阅连接。只挂载 `/api/library`、`/api/sessions` 等应用接口。
- **启动器**（`packages/cli`）：解析 profile，先启动 Python 文献服务并等它就绪，再启动 server；负责两者的
  重启与关闭。server 不启动、不重启、不配置 Python。
- **LibraryClient**（`server/src/lib/`）：server 调用文献服务 API 的客户端（会话范围、上下文、项目目录），
  地址来自启动器传入的 `LIBRARY_URL`。
- **Python HubLibrary**（`scholaraio/hub/`）：文件、元数据、哈希去重、解析任务、索引和检索，复用上游
  stores 与 chunks/index 服务。业务代码与运行数据完全分离。分层见下节。
- **SessionStore**：应用自己的会话 ID、关联文献、显示消息和私有的原生 ID，每个会话一个 JSON，原子写入。
- **SessionService**：组织文献上下文与本轮输入、防重复提交、持久化运行、流订阅、排队与审批。
- **Supervisor / Provider**：CLI 协议、进程生命周期、登录、原生恢复、中断与权限。

依赖方向：UI → HTTP → 文献 / 会话服务；会话服务调用文献服务和 Supervisor。文献模块不管理对话，CLI 原始协议不进入浏览器。

## Python 文献服务分层

依赖只向下：`interfaces/api` → `hub` 服务 → `hub.runtime` / `hub.repository` → 上游 `services` / `stores`。
`tests/test_hub_layers.py` 从 import 语句校验这个方向。

- `interfaces/api/routes/*`：按领域拆分的薄控制器，只解析参数、调用一个服务、返回结果；通过
  `dependencies.py` 取服务，不读 `app.state`，不导入 stores。`schemas.py` 定义请求体（属性 snake_case，
  线上字段 camelCase）；`errors.py` 统一 `{"error": ...}` 响应。
- `hub/*` 服务：`PaperService`、`SearchService`、`RetrievalService`、`DiscoverService`、`ProjectService`、
  `CitationService`、`MetadataService`、`ExportService`、`SettingsService`、`AnalyticsService`、
  `LibraryStatus`；后台为 `ImportQueue`、`AcquireService`、`TaskRunner`（通用执行器）+
  `MaintenanceJobs`（各任务类型的策略）、`ProjectWatcher`。服务经构造函数接收 `LibraryRuntime`
  与所用的兄弟服务，不回引 `HubLibrary`。
- `hub/runtime.py`：配置、写锁、`PaperRepository`、`EventBus`、重建索引等共享基础设施。
- `hub/repository.py` 与 `hub/views.py`：磁盘上的论文（按 UUID 寻址）及其对浏览器的行结构；其他模块不再各自遍历目录或拼装行。
- `hub/errors.py`：`InvalidRequest`(400)、`NotFound`(404)、`TooLarge`(413)。上游沿用
  `ValueError` = 拒绝请求、`RuntimeError` = 数据损坏(500)；普通 `KeyError` 视为缺陷，返回 500 而不是 404。
- `hub/library.py`：组合根，唯一负责装配与生命周期。

## 会话消息与恢复

Provider 适配器（`ClaudeEventAdapter`、`CodexEventAdapter`）把原生消息转成统一的 `AgentEvent`
（`providers/events.ts`），它是 provider 到 hub 的唯一消息模型。`UIChunkWriter` 再把事件写成 AI SDK
UI Message Stream。客户端用 `useChat` + `DefaultChatTransport`，每次 POST 只带本轮消息 ID 与文本；
文本、推理、工具内容都在客户端渲染，差异视图用 `@pierre/diffs`。

CLI 原生记录用于恢复上下文，应用记录用于显示。进行中的回复每秒节流保存一次，结束时原子写入。
重新订阅从当前回复开头重放，快照接口排除这条回复，避免刷新后重复追加；输入 ID 防止重复提交。
浏览器断开只释放订阅，不中断 CLI。停止先请求原生 interrupt，未及时结束则释放 worker，之后从原生 ID 恢复。
空闲 worker 超过 `IDLE_TIMEOUT` 后释放，不影响已保存会话。服务重启时，未结束的运行记为
`interrupted`，不自动重发用户输入。

运行中的流只保存在进程内，不引入 Redis、消息总线或数据库。会话状态机见
[`.claude/topics/session-state.md`](../.claude/topics/session-state.md)。

## 文献上下文

会话创建时固定 provider 和文献范围：单篇、多篇，或空列表表示全库。发送前检索有限片段；引用带文献
UUID、chunk ID 和行号。客户端只把本轮实际提供的引用转成阅读器链接。PDF 解析生成的分页 Markdown
和历史 Markdown 都按实际行号定位，没有页码映射时不推算 PDF 坐标。

PDF 原件先入库，再提取和索引。任务、逐项错误和重试信息都会持久化。没有文本层或解析失败的 PDF
保留原件并标记 failed，不当作已完成全文索引展示。索引可以重建，用户元数据与附件会保留。

## 数据目录与启动

入口按 profile 解析数据根目录并注入各服务（规则见 README「入口与 profile」）。CLI 凭据和原生历史由各
CLI 自己管理，不参与应用数据迁移。

`pnpm hub setup` 在数据根目录下的 `runtime/python` 中建 uv 环境，只安装锁定的 hub 依赖；语义检索运行时
由文献服务按需装进自己的环境（`POST /runtime/semantic`），装完以退出码 75 退出，启动器随即重启它。
各能力对应的 extras 记在 `packages/scholaraio/runtime-capabilities.json`，setup 与文献服务共用。

文献服务监听 profile 给定的端口（`LIBRARY_PORT`，默认 Hub 端口 + 1），与 Hub 同一套访问规则：Host 白名单、
修改请求必带 `ScholarAIO-Hub` 头、CORS 只放行 Hub 页面的来源；不再有内部令牌。它自己写日志
（生产环境另写 `<数据目录>/logs/library.log`）。setup、doctor、migrate 与启动共用启动器的 profile 模块。
开发时使用专用的 `scholaraio-source` 导出条件，避免通用 `source` 条件误选第三方依赖的未编译源码。

启动器给 Python 保留一条专用 stdin 管道并传入 `--watch-stdin`。启动器退出或被杀导致管道 EOF 时，
Python 主动关闭；清理超时则强制退出，未完成的导入在下次启动时标记为可重试。server 热重载不影响 Python。
Python 意外退出时启动器重启它（5 分钟内至多 3 次）。单独启动 Python 时默认不监听 stdin。

## CLI 集成要点

- **Claude**：从 Agent SDK 自身依赖解析原生 CLI；显式可执行路径优先，出错不静默回退。保留
  user/project/local 设置来源、partial messages、resume 和 `canUseTool`；不让 `ANTHROPIC_MODEL`
  覆盖 CLI 自身的模型设置。
- **Codex**：经 stdio app-server 执行 initialize、`thread/start` 或 `thread/resume`、`turn/start`；
  停止使用 `turn/interrupt`。RPC 有超时，进程退出时清理。协议类型的维护见
  [`providers/codex/protocol/README.md`](../packages/server/src/providers/codex/protocol/README.md)。
- 两者都只传本轮新增输入，权限审批在 Supervisor 中处理。服务端内部环境变量不传给子进程
  （`providers/agent-env.ts`），CLI 自身的认证与代理配置保留。
- CLI 检测会实际运行 `--version`，不能仅因 PATH 里有脚本就判定可用；本地登录状态也不能保证远端令牌仍然有效。

## 迁移与恢复

`pnpm hub migrate`（`python -m scholaraio.hub.migration`）显式执行 plan / apply / rollback。清单记录每个文件的源、
目标、大小和哈希，并保留 UUID 集合。apply 先检查目标冲突、磁盘空间和源快照，独立备份，再用持久化的移动日志
记录每一步。同一文件系统内直接移动，避免再复制一份大库。配置原子发布，最后重建关键词索引；任何失败都保留清单供 rollback。

回滚先校验所有备份、现有文件和配置，再恢复；遇到迁移后的新修改会拒绝覆盖。配置与清单以 0600 权限写入，
含本地密钥的原配置不进入版本库。开发环境从不自动使用生产文献。
