# ScholarAIO 能力接入设计

目标：前端可批量导入 PDF 并走完整入库流水线；工作空间成为 coding agent 的真实项目目录，并带可增删的文献集；ScholarAIO 的原生能力同时以 CLI（给 agent）和 HTTP 接口（给前端）两种形式开放。

## 已确定的决策

1. PDF 解析使用 MinerU 云端。
2. 向量嵌入使用本地模型，支持自动下载与配置。
3. 查不到 DOI 的文献直接入库，标记元数据不完整，不进人工待确认队列。
4. 不迁移上游个人库 `~/.scholaraio`。
5. 所有写操作统一走 Hub 接口，CLI 不直接写数据目录。

## 现状的四处断层

### 1. 前端导入没有走原生流水线

`HubLibrary.import_pdf`（`packages/scholaraio/scholaraio/services/hub_library.py`）只用 pymupdf 抽文本，标题取 PDF 自带元数据，目录名为 UUID。原生流水线 `mineru → extract → dedup → ingest → toc → l3 → embed → index`
（`services/ingest/step_registry.py`）完全没有执行。

后果：这批文献没有 DOI、没有引用数据、没有向量、没有目录与结论。依赖这些数据的能力——参考文献、库内被引、共同参考文献、被引排序、语义检索、主题分析——对它们全部为空。

另有暂存冲突：Hub 把上传文件写入 `cfg.inbox_dir`，而原生 `process_inbox` 扫描的正是同一目录。

### 2. 原生流水线不是按任务设计的

`process_inbox`（`services/ingest/inbox_orchestration.py`）扫描目录、整批处理，进度只通过 `_ui()` 打印到终端，没有逐项回调，也不返回每个文件的结果。启用外部查询时每篇间隔 2 秒。失败项被移入 `pending/` 并写 `pending.json`。

### 3. 工作空间只是文献清单，不是工作目录

`HubProjects`（`services/hub_projects.py`）复用原生 workspace 格式（`workspace/<name>/refs/papers.json`），但仅用于缩小检索范围。会话真正的 cwd 是私有的 `sessions/<id>/workspace`。

`SessionService.attach()` 通过 `projectPath` 等于会话目录来匹配会话，隐含"一个会话一个目录"的前提。多个会话共用同一项目目录会挂错会话——这是目标 2 的硬阻塞。

### 4. agent 调用的 CLI 连的是另一个文献库

科研 skill 从 `~/scholaraio/skills` 读取——那是另一个仓库的检出，既不属于应用数据，也不受应用管理。skill 内容是让 agent 执行 `scholaraio ...`。而 agent 进程中 `scholaraio` 解析到 miniconda 的全局安装，读取 `~/.scholaraio/config.yaml`，也就是上游个人库。Hub 自己环境里的 CLI（`runtime/python/bin/scholaraio`）既不在 PATH 上，也没有 `SCHOLARAIO_CONFIG`。

前端与 agent 看到的是两套数据。

## 目标架构

```
前端 ──HTTP──> Node (Hono)
                 ├── /api/library/*      转发至 Python
                 ├── /api/projects/*     项目与文献集
                 └── /api/sessions/*     会话

agent ──CLI──> scholaraio (Hub 运行环境)
                 ├── 读命令：直接读数据目录
                 └── 写命令：HTTP 调用 Hub 接口

Node ──子进程──> Python FastAPI (interfaces/api)
                 └── 复用 services/*、stores/*、projects/*
```

单一数据目录，单一写入者（Python 进程），两条对外通道。

## 一、导入流水线

### 任务模型

Hub 继续拥有任务队列，但逐篇调用原生步骤函数，不再调用扫描目录的 `process_inbox`。

- 暂存隔离：每个任务使用 `state/imports/<job>/staging/`，不再写 `inbox_dir`。
- 逐篇执行：为每篇构造 `InboxCtx`，按预设依次调用步骤函数，每步结束后更新 `item.step` 与 `item.status` 并持久化。需要把 `inbox_orchestration.py` 中的逐文件循环抽成可复用函数，接受 `on_step` 回调。
- 批次级步骤：`embed` 与 `index` 整批执行一次。
- 深度处理：`toc` 与 `l3` 依赖大模型，作为可选的后台阶段，不阻塞导入完成。
- 进度推送：复用会话已有的订阅通道，替代前端轮询。

### 条目状态

| 状态 | 含义 |
|---|---|
| `queued` / `running` | 排队、执行中，附带当前步骤名 |
| `completed` | 入库成功，元数据完整 |
| `completed_incomplete` | 入库成功，但缺 DOI 等关键元数据 |
| `duplicate` | 与已入库文献重复，返回已有文献 ID |
| `failed` | 失败，附带原因与所用解析器 |

### MinerU 云端

- `mineru-cloud` 依赖组（提供 `mineru-open-api` 命令）加入 Hub 运行环境的安装列表。
- 配置：`ingest.pdf_preferred_parser = "mineru"`，token 存入数据目录的 `config.yaml`，权限 0600。
- 批量转换用 `convert_pdfs_cloud_batch`；本地 MinerU 探测（`check_server`）在云端模式下跳过。
- 降级链保留：云端失败时按 `pdf_fallback_order` 依次尝试 docling、pymupdf。前端需展示本次实际使用的解析器与降级原因。
- 云端需要上传文件。设置页必须明确说明这一点，并允许关闭云端、只用本地解析器。

### 无 DOI 的处理

`step_dedup` 增加策略开关（如 `opts["no_doi_policy"] = "ingest" | "review"`），Hub 传 `"ingest"`：

- 跳过 `move_to_pending`，继续执行 `step_ingest`；
- 元数据写入 `metadata_status: "incomplete"` 与缺失字段列表；
- 条目状态为 `completed_incomplete`。

重复文献仍然拦截，行为不变。

前端提供"元数据不完整"筛选视图，支持手动补 DOI 后重跑 `refetch` 与 `index`。

### 本地嵌入模型

- `embed` 依赖组需补上 `modelscope`（当前只在 `full` 组里）。
- 模型下载不能发生在检索请求中。新增显式的"准备语义检索"任务：下载模型、构建向量索引，带进度，可取消。
- 未就绪时语义检索返回明确状态，由前端引导用户启动准备任务，不静默降级成关键词检索而不告知。
- 设置页暴露：模型名、来源（ModelScope / HuggingFace）、缓存目录、设备（auto / cpu / cuda）。

## 二、工作空间

### 目录布局

`workspace/<id>/` 本身即 agent 的 cwd：

```
workspace.yaml        名称、描述、创建时间、outputs.default_dir
refs/papers.json      文献集（原生格式，CLI 可直接读）
AGENTS.md             自动生成：项目说明、可用命令、文献集摘要
outputs/              agent 产出
```

`workspace.yaml` 的校验逻辑（`projects/workspace.py`）已支持 name、description、mounts、outputs，直接复用。

### 会话与进程

- 会话记录 `projectId`，cwd 改为项目目录；无项目的会话使用私有草稿目录。
- `SessionService.attach()` 不再按目录反查，改为启动时显式关联会话 ID。
- 需要确认 Supervisor 是否按目录去重进程；同一项目目录下必须允许多个会话并存。

### 文献集操作

新建、改名（`workspace.rename`）、删除（移入回收区，不直接删盘）、增删文献、按检索结果或主题批量添加、导出 BibTeX。全部经由 Hub 接口，共用 Python 端同一把锁。

agent 通过 CLI 改动 `refs/papers.json` 后，Hub 监听该文件变化并推送前端；读取前校验内容完整性，避免读到写了一半的文件。

### 上下文

保留"发送消息前按项目范围检索片段并注入"的现有逻辑。同时让 agent 能够自行使用 `--ws` 查询：`refs`、`citing`、`shared-refs`、`citation-check` 都已支持该参数。

## 三、能力分层

共用一层返回结构化数据的服务函数，外面包两层薄接口：CLI 统一增加 `--json`；HTTP 按领域拆分路由，不再集中在 `interfaces/api/__main__.py`。

| 领域 | 服务入口 | 前端待补 |
|---|---|---|
| 检索 | `index.search` / `search_author` / `unified_search`、`vectors.vsearch`、`chunks.chunk_search`、`fsearch` | 片段级原文定位、年份与期刊与类型筛选、跨库检索 |
| 引用图谱 | `get_references` / `get_citing_papers` / `get_shared_references` / `top_cited` | 参考文献、库内被引、共同参考文献、引用网络图 |
| 元数据维护 | `refetch`、`backfill-abstract`、`audit`、`repair`、`rename` | 质量检查面板、批量补全、单篇修正 |
| 深度处理 | `toc`、`l3`、`translate` | 阅读器的目录层、结论层、译文层 |
| 主题分析 | `topics.build_topics` / `reduce` / `merge`、`insights` | 构建与重建任务（当前只读已有结果） |
| 外部采集 | `arxiv`、`explore`（OpenAlex）、`ingest-link`、`fetch-pdf`、`import-zotero` / `endnote`、专利 | 发现页：外部检索后一键入库 |
| 写作支持 | `export`、`citation-check`、`style`、`diagram` | 项目导出、引用核查 |
| 运维 | `setup check`、`backup`、`metrics` | 环境检查、大模型用量 |

### CLI 接入 Hub

1. 启动 agent 时将 `runtime/python/bin` 置于 PATH 最前，并设置 `SCHOLARAIO_CONFIG` 指向数据目录的配置。两项需在 `sdk/providers/env-filter.ts` 放行。
2. 写命令（`ws add` / `remove`、`pipeline`、`enrich`、`repair`）改为 HTTP 客户端模式：CLI 检测到 Hub 地址与令牌环境变量时，把请求转给 Hub 接口，由 Hub 单进程串行执行。读命令仍可直接读数据目录。
3. Skills 移入数据目录 `<dataDir>/skills`，作为用户可编辑的数据由应用管理，不混入仓库代码；首次启动时从旧位置导入一次，之后以数据目录为准。skill 里的命令改用 `--json` 形式，并约定默认带上当前项目的 `--ws`。
4. 可选：将只读的检索、引用、工作空间能力另包一层 MCP，供 Claude 与 Codex 以结构化工具调用，比解析文本输出可靠。`providers/mcp.py` 已有客户端实现可复用。

## 实施进度（2026-09-23）

**P0 统一数据源 — 已完成**（`6abc32e`）
数据目录生成 `config.yaml`；agent 进程注入 `SCHOLARAIO_CONFIG` 与运行环境 PATH；skills 移入 `<dataDir>/skills`（首启从旧位置导入一次）；CLI 写命令在 Hub 会话中停用，`ws init/add/remove/rename` 转交 Hub 接口。

**P1 导入流水线 — 已完成**（`cd9c78b`、`dccbb20`、`293c0d6`）
逐篇执行 `mineru → extract → dedup → ingest`，上传暂存独立于原生 inbox，批次结束统一重建索引；状态含 `completed_incomplete`、`needs_review` 与当前步骤；无 DOI、无标题时按文件名入库并标记不完整。设置页可配置 MinerU token、LLM key、提取模式与嵌入后端，写入 `config.local.yaml` 并即时生效，密钥只写不回显。进度改为事件流推送，流断开时退回轮询。深度处理（toc / l3）作为后台任务。

**P2 工作空间即项目目录 — 已完成**（`08ad154`、`29a18a6`、`293c0d6`）
会话 cwd 为项目目录（路径由 Python 提供）；进程带会话 id，`attach()` 不再按路径反查；项目重命名与归档经 Node 路由同步会话归属；新建项目生成 `AGENTS.md` 与 `outputs/`；`refs/papers.json` 的外部改动由看守线程发现并推送。

**P3 引用与元数据 — 已完成**（`29a18a6`、`3c12053`、`cdbf129`）
参考文献、库内被引、共同参考文献、被引排序四个接口，按项目范围过滤；详情面板可补 DOI、重新查询元数据；仪表盘展示 audit 结果，缺失摘要由质量补全任务填充。

**P4 其余能力 — 已完成**（`ee03361`、`ee6b131`、`ec17b32`、`5926dcf`、`81a8025`、`cdbf129`）
语义检索、主题构建、深度解析、质量补全四类后台任务，带阶段、进度与停止；嵌入模型首次运行自动下载，向量分批写入，停止后保留已完成部分；主题任务写出仪表盘读取的 overview / projection / similarity。按 DOI、arXiv 编号、专利号或链接获取入库；Zotero / EndNote 经 BibTeX / RIS 导出文件批量获取。BibTeX / RIS / Markdown 导出与正文引用核查。agent 的 CLI 可把取文献、建索引等写操作转交 Hub 执行。

未做：只读 MCP 层（现有 CLI 与接口已覆盖同样的读取能力，暂无独立需求）。

## 实施顺序

**P0 统一数据源**
PATH 与 `SCHOLARAIO_CONFIG` 注入；数据目录生成 `config.yaml`；skills 迁入数据目录；CLI 写命令改走 Hub 接口。不做这步，后续所有工作都建立在两套数据之上。

**P1 导入流水线**
暂存隔离；逐篇步骤执行与进度推送；无 DOI 标记入库；MinerU 云端配置与依赖；设置页。

**P2 工作空间即项目目录**
会话 cwd 切换；`attach()` 关联方式改造；文献集增删改查；`refs/papers.json` 变更监听。

**P3 引用与元数据**
引用图谱与元数据补全接口及前端。依赖 P1——有 DOI 才有引用数据。

**P4 其余能力**
语义检索准备任务与本地模型配置；主题构建；外部采集；导出与引用核查；MCP。

## 风险

- **Supervisor 的目录假设**：多个会话共用一个项目目录是 P2 的前提，需先确认进程管理层没有按目录去重。
- **并发写入**：P0 完成前，CLI 与 Hub 会同时写同一份数据。P0 应优先于 P1。
- **云端上传**：PDF 会离开本机。默认开启前需要用户明确知情。
- **本地模型体积**：torch 与嵌入模型合计数 GB。安装与下载必须是显式的、可跳过的步骤，不能塞进默认 setup。
- **外部查询速率**：每篇间隔 2 秒是既有行为。大批量导入耗时很长，任务必须可中断、可续跑。
