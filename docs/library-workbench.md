# 文献工作台架构

## 职责

保持 client / server / shared，新增同仓库 Python 源码包 scholaraio。

- client/app：文献库、阅读器、会话、设置的导航。features/library 负责导入、检索和阅读，features/session 负责标准消息显示；shared/components/Markdown 统一 Streamdown。
- server/routes：校验、响应、二进制文件流和订阅连接。仅显式挂载 /api/library 与 /api/sessions 等应用接口。
- LibraryService：启动 Python、就绪检查、内部认证、HTTP 调用、关闭子进程。浏览器不能直接配置或调用 Python 地址。
- Python HubLibrary（`scholaraio/hub/`）：文件、元数据、哈希去重、解析任务、索引和检索，复用 ScholarAIO stores 与 chunks/index 服务。业务代码与运行数据完全分离。分层见下节。
- SessionStore：应用稳定 ID、关联文献、标准消息和私有原生 ID，按会话 JSON 原子写入。
- SessionService：组织文献上下文和当前输入、检查重复提交、持久化运行、流订阅与审批。
- Supervisor / Provider：CLI 协议、进程生命周期、登录、原生恢复、中断与权限。

依赖方向是 UI → HTTP → 文献 / 会话服务；会话服务调用文献服务和 Supervisor，不让文献模块管理对话，也不把 CLI 原始协议传到浏览器。

### Python 文献服务分层

依赖只向下：`interfaces/api` → `hub` 服务 → `hub.runtime` / `hub.repository` → 上游 `services` / `stores`。

- `interfaces/api/routes/*`：按领域拆分的薄控制器，只做参数解析、调用一个服务、返回结果；通过 `dependencies.py` 声明依赖的服务，不读 `app.state`，不导入 stores。`schemas.py` 定义请求体（Python 属性 snake_case，线上字段 camelCase）；`errors.py` 统一 `{"error": ...}` 响应。
- `hub/*` 服务：`PaperService`、`SearchService`、`RetrievalService`、`ProjectService`、`CitationService`、`MetadataService`、`ExportService`、`SettingsService`、`AnalyticsService`、`LibraryStatus`；后台为 `ImportQueue`、`AcquireService`、`TaskRunner`（通用执行器）+ `MaintenanceJobs`（各任务类型的策略函数）、`ProjectWatcher`。服务经构造函数接收 `LibraryRuntime` 与所用的兄弟服务，不回引 `HubLibrary`。
- `hub/runtime.py`：配置、写锁、`PaperRepository`、`EventBus`、重建索引——所有服务共享的基础设施。
- `hub/repository.py` 与 `hub/views.py`：磁盘上的论文（按 UUID 寻址）及其对浏览器的行结构，其余模块不再各自遍历目录或拼装行。
- `hub/errors.py`：`InvalidRequest`(400)、`NotFound`(404)、`TooLarge`(413)。上游沿用 `ValueError`=拒绝请求、`RuntimeError`=数据损坏(500)；普通 `KeyError` 等视为缺陷，返回 500 而不是 404。
- `hub/library.py`：组合根，唯一负责装配与生命周期。

`tests/test_hub_layers.py` 从 import 语句校验上述方向。

## 会话协议与恢复

标准显示模型采用 AI SDK UIMessage，SessionMessageNormalizer 将 Claude stream_event / 快照及 Codex 事件转成 UI Message Stream。客户端使用 useChat 和 DefaultChatTransport，每次 POST 仅含本轮消息 ID 与文本。文本、推理与工具内容由客户端渲染；差异使用 @pierre/diffs，原服务端 Markdown / diff HTML 增强和双重合并已删除。

CLI 原生记录用于上下文恢复；应用记录用于显示。进行中的消息每秒节流保存，结束时原子写入。重新订阅从当前回复开头重放，历史接口排除该回复，避免刷新后重复追加；输入 ID 防止重复提交。断开浏览器只释放订阅，不中断 CLI。停止请求调用原生 interrupt，并释放对应 worker，后续从原生 ID 恢复。空闲 worker 达到 IDLE_TIMEOUT 后也会释放，不影响已保存会话。重启把未结束运行记为 interrupted，不自动重发用户输入。

当前流保留在进程内，不引入 Redis、独立消息总线或数据库。旧 JSONL 历史只在用户选取上传时解析，导入记录只读。旧通用代码项目 API、扫描服务虽有部分底层源码保留，应用入口不再初始化和挂载它们。

## 文献上下文

会话创建时固定 provider 与文献范围：单篇、多篇、或空列表代表全库。发送前检索有限片段；引用包含文献 UUID、chunk ID 和行号。客户端只把本轮已提供的有效引用转换成阅读器链接。PDF 解析生成的页分节和历史 Markdown 都按实际行号定位，没有页码映射时不构造 PDF 坐标。

PDF 原件先入库，再提取和索引。任务、逐项错误及重试信息持久化。没有文本层或解析失败的 PDF 保留原件并标记 failed，不作为已完成全文索引展示。索引允许重建，用户元数据与附件保留。

## 数据目录与启动

入口解析数据根目录，注入服务。production / development / test 使用独立根目录；显式 SCHOLARAIO_HUB_DATA_DIR 优先。CLI 凭据、原生历史由 CLI 管理，不混入应用目录迁移。

Node 管理数据根目录 runtime/python 中的 uv 环境；仅安装锁定 hub 依赖，不默认下载向量模型。Python 绑定 loopback 动态端口，并使用每次启动生成的内部令牌。setup、doctor、migrate 工具与启动使用同一配置模块。开发使用专用 scholaraio-source 导出条件，避免通用 source 条件意外选择第三方依赖的未编译源码。

Node 为 Python 保持专用 stdin 管道，并传入 `--watch-stdin`。热重载、进程退出或崩溃导致管道 EOF 时，Python 请求正常关闭；清理超过 5 秒仍未完成则强制退出，未完成导入在下次启动时标记为可重试。单独启动 Python 时不默认监听 stdin。生产、开发、测试默认端口分别为 3400、3500、3600，均由 shared 统一解析；显式 `PORT` 优先。

## CLI 兼容记录（2026-09-20）

对照 [YepAnywhere cf1bf29](https://github.com/xueyouxz/yepanywhere/commit/cf1bf29cbaf04d746b45001a1f54f22f8ee5a3ce) 的 Claude/Codex Provider、CLI 检测和环境过滤实现。

- Claude：从 Agent SDK 自身依赖范围解析原生 CLI；显式可执行路径覆盖优先且错误不静默回退。保留 user/project/local 设置来源、partial messages、resume 和 canUseTool；不继承 ANTHROPIC_MODEL 覆盖 CLI 自身模型设置。
- Codex：通过 stdio app-server 初始化、thread/start 或 thread/resume、turn/start；客户端标识 scholaraio-hub。默认 on-request + workspace-write，停止使用 turn/interrupt；RPC 有超时及进程退出清理。
- 两者只传入本轮新增输入，权限审批继续在 Supervisor 中处理。过滤服务端内部环境变量；保留 CLI 自身认证与兼容代理配置。
- CLI 检测实际运行 --version，不能仅因 PATH 中存在脚本就判定可用；本地登录状态不能保证远端令牌仍有效。

本机原 Codex 0.112.0 安装缺少平台二进制；重新安装同版本后仍不可运行。已安装官方 0.155.1 并验证可执行。生成协议类型未手改：现有运行时使用的初始化、会话、增量文本、审批、结束与中断字段通过协议样本及真实请求检查。不存在包级强制 CLI 版本锁；升级后需重跑协议与真实验收。

## 迁移与恢复

`python -m scholaraio.hub.migration`（`pnpm migrate`）显式执行 plan / apply / rollback。清单包含每个文件的源、目标、大小及哈希，并保留 UUID 集合。apply 检查目标冲突、磁盘空间与源快照，先独立备份，再使用持久化移动日志记录操作。同文件系统移动避免再复制一份大库。配置原子发布，最后重建关键词索引；任何失败保留清单供 rollback。

回滚先验证所有备份、现有文件和配置，再恢复。新修改发生冲突时拒绝覆盖。配置与清单以 0600 写入，含本地密钥的原配置不进入版本库。开发环境从不自动使用生产文献。
