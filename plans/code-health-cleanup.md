# 重构计划：代码健康清理（死代码、重复、命名、遗留架构）

## 背景

项目从 yepanywhere 裁剪而来，又经历了多轮按功能推进的重构。每轮只改到当前关心的路径，
于是留下三类债：

1. **休眠架构**：为多客户端/远程场景设计的机制（worker 池、事件总线、relay 安装 ID、
   JSONL schema）在本地单用户 Hub 里从不执行，但有测试，看起来是活的。
2. **同一事实多处定义**：配置解析三遍、`SessionOwnership` 三份、CSRF 头字面量五处、
   env 过滤名单与 env schema 各自维护。
3. **命名与位置失真**：`core/library.ts` 装着全部 API、`watcher/` 里没有 watcher、
   `hasPdf` 表示「有全文 Markdown」。

2026-09-24 的静态扫描（TS 编译器 API 建模块图 + 逐个追调用方）给出了下文的清单。

## 原则

1. 删除以「生产路径能否到达」为准，不以「有没有测试」为准；只测死功能的测试一起删。
2. 每条事实一个定义点，其余地方引用它。
3. 依赖在组装根（`packages/server/src/index.ts`）显式传递，不用模块级可变全局，也不用
   `?? getDataDir()` 这类隐式默认值。
4. 不做一次性全仓改名；目录/文件改名只在该文件没有未提交改动时做。

## 不做

- `packages/scholaraio` 中来自上游的 Python 代码（`UPSTREAM.md`）：只动 Hub 自有部分。
- 生成代码 `codex-protocol/generated/`。
- 前端视觉/交互改动。

## 约束：工作区有大量未提交改动（WIP）

WIP 覆盖 `sdk/providers/{claude,codex}.ts`、`SessionService.ts`、`app.ts`、
`routes/library.ts`、shared `types.ts`/`library.ts`/`StoredSession.ts`、`core/library.ts`、
`Sidebar.tsx` 及大部分 `features/library`、`features/session` 文件。

- 改到 WIP 文件时只暂存本计划的改动块，WIP 原样留在工作区。
- 需要整文件移动/改名、或与 WIP 大面积重叠的项标为 **延后**，等 WIP 提交后再做。

## 阶段

实际顺序：阶段 3 先于阶段 2（shared 的 `SESSION_TITLE_MAX_LENGTH` 只被阶段 3 删除的
`SupervisorEvents` 使用）。每阶段独立提交，跑通 typecheck + 单元测试 + lint（WIP 的既有问题除外）后再进入下一阶段。
不 push、不开 PR。验证不重建 `packages/{server,client}/dist`（生产 Hub 3400 在用）。

### 阶段 1：仓库卫生与 AI 协作文档

- [x] 恢复被 `05fe8de` 意外清空的 `CLAUDE.md`，并按现状更新（入口、端口、目录）。
- [x] `.claude/rules/server.md`：去掉不存在的 `src/subscriptions.ts`、`watcher`，端口说明对齐 profile。
- [x] 删除误提交的测试产物 `packages/scholaraio/workspace/figures/`（20 个），加入 `.gitignore`。
- [x] 删除孤立的 `packages/server/pnpm-lock.yaml`、过时的 `packages/server/README.md`
      （绝对路径、不存在的 provider）。
- [x] 删除从未被 import 的前端文件：`PaperCollection.tsx`、`hooks/useChartSize.ts`。
      （`ThinkingIndicator.tsx`、`shared/ui/ChipGroup.tsx` 只在 WIP 版本里无人引用，已提交的代码仍在用，
      保留；随 WIP 一起删。）

### 阶段 2：shared 死 schema 与重复类型

- [x] 删除无消费方的 `claude-sdk-schema/`、`codex-schema/`、`ideMetadata.ts`、
      `session/SessionView.ts`（`SESSION_TITLE_MAX_LENGTH` 迁到使用处的定义点）及其测试。
- [x] `app-types.ts` 删除 `App*Message`、`AppContentBlock`、`AppSessionSummary`、
      `AppSession`、`AgentSession`、`AgentStatus`。
- [x] `SessionOwnership` 只保留一份（shared），server `supervisor/types.ts` 引用它。
- [x] 删除其余零使用导出（`SharedReference`、`LibraryAudit`、`FileMetadata`、`PatchHunk`、
      `EditAugment`、`FileContentResponse`、`Upload*Message` 等）。

### 阶段 3：server 休眠架构

- [x] 删除 relay 遗留链：`InstallService`（+ `install.json`）、`installId` 透传、
      `/api/version`（前端无消费方）。
- [x] 删除 `watcher/EventBus.ts`、`supervisor/SupervisorEvents.ts`、`supervisor/WorkerQueue.ts`。
- [x] Supervisor 收缩为会话进程注册表：保留 start/resume/providerFor/空闲回收/close；
      删除池上限、排队、抢占、hold、延迟消息、`onSessionSummary`/`onSessionExecutor`，
      `SessionLaunch` 只剩 started。Process 删除外部从不调用的成员。
- [x] 删除零使用导出（`summarizeCodexNormalizedMessage`、`extractTextFromMessage`、
      `TimestampedSDKMessage`、`AgentEventType`）与 env schema 中无人读取的 `CLAUDE_CONFIG_DIR`。

### 阶段 4：配置与组装根

- [x] env 过滤名单由 `RuntimeEnvSchema` 的键生成；删掉 `MAINTENANCE_PORT`/`AUTH_DISABLED`/
      `PROXY_DEBUG`，补上漏掉的 Hub 内部变量。
- [x] 配置只解析一次：去掉 `config.ts` 中与 schema 重复的 `parse*`；logger 默认配置不再自读 env。
- [x] 去掉 `?? getDataDir()` 隐式默认；`data-dir.ts` 并入 `runtime/profile.ts`。
- [x] `setLibraryDataDir`/`setHubApiBaseUrl` 合并为入口一次绑定的 `bindAgentLibrary`；
      彻底去掉模块全局（provider 按 app 构建）移到阶段 7。
- [x] `routes/library.ts` 白名单：删被 `routes/projects.ts` 覆盖的两条，去掉类型补丁。
- [x] `app.ts`：谁创建谁关闭（`LibraryService` 不再被关两次）。`/api/status` 拆到
      `routes/status.ts` 移到阶段 7（该处理函数正是 WIP 在改的代码）。

### 阶段 5：CSRF 头与前端请求入口

- [x] CSRF 头名放到 shared，server 中间件与前端引用同一常量（e2e 保留字面量：测试独立陈述线上协议）。
- [x] 前端上传/流式请求经 `core/http.ts` 统一加头，不再自己拼。

### 阶段 6（延后，需 WIP 提交）：前端模型与命名

- [ ] 拆 `core/library.ts` 为 `core/api/{library,sessions,settings,skills}.ts`。
- [ ] 统一论文模型：删 `core/scholarTypes.ts` 的 `ScholarPaper` 与 `libraryAdapter.ts`，
      直接用 shared `LibraryPaper`；`hasPdf`→`hasFullText`、`citations` 改为 number。
- [ ] 相对时间/字节格式化合并为 `shared/format.ts`，界面文案统一中文。

### 阶段 7（延后，需 WIP 提交）：server 目录与文件命名

- [ ] provider 按 app 构建（不再是模块单例），代理环境由组装根注入，删掉 `bindAgentLibrary`。
- [ ] `/api/status` 两个处理函数移到 `routes/status.ts`。

- [ ] `sdk/` + `codex/` → `providers/{claude,codex}/`；`routes/app-sessions.ts` → `routes/sessions.ts`。
- [ ] shared `types.ts`/`app-types.ts` 按领域拆分。
- [ ] 文件命名约定：类文件 Pascal，其余 kebab；随改随统一。

## 风险

- Supervisor 收缩改动面最大：依赖 `test/api/*` 的会话端到端单测兜底；
  改前先确认 `SessionService` 只使用保留下来的接口。
- 删除 shared 导出是契约变更：以 `pnpm typecheck` 覆盖 client + server。

## 进度

- 阶段 1：`CLAUDE.md` 按现状重写（入口、端口、Python 服务、「可达才算活」规则）；
  glossary / resource-lifecycle / server 规则 / CONTRIBUTING 去掉不存在的 `subscriptions.ts`、
  `watcher/`。删除 20 个误提交的 figures、server 孤立锁文件与 README、2 个未引用组件。
  验证：client typecheck、182 个单测通过。
  **更正**：最初扫描跑在含 WIP 的工作区上，把 `ChipGroup`/`ThinkingIndicator` 也当成死代码删了，
  而已提交的 `sources.tsx`、`WorkspaceCreateDialog.tsx`、`ProcessingIndicator.tsx` 仍引用它们。
  已用 `commit-tree` 改写这两个未 push 的提交，把两个组件和样式放回；它们在工作区显示为
  WIP 删除。此后每阶段提交前都把暂存区导出到临时目录单独 typecheck + 测试。
- 阶段 3：删除 `EventBus`、`SupervisorEvents`、`WorkerQueue`、`InstallService`、`/api/version`、
  `projects/paths.ts`（只剩 Supervisor 引用）。Supervisor 从 1267 行收缩为约 300 行的会话进程
  注册表：`startSession`/`resumeSession` 直接返回 `Process`，`SessionService` 不再处理排队/拒绝分支。
  Process 去掉 hold、延迟消息、`getInfo`、`projectId`、`pid`、`modeVersion`、动态模型/命令查询、
  首条消息标题、测试专用的 legacy 队列（`queue` 改为必填）；监听器异常改为记录日志而非静默吞掉，
  删掉 `handleToolApproval` 的调试 `console.log`。provider 契约去掉无人读取的 `pid`、
  `executor`、`remoteEnv`。另删 `summarizeCodexNormalizedMessage` 及其 190 行辅助函数、
  `extractTextFromMessage`、`TimestampedSDKMessage`、`AgentEventType`、env 的 `CLAUDE_CONFIG_DIR`。
  验证：server typecheck、biome、246 个单测通过（减少的约 110 个是只测已删功能的用例）。
- 阶段 2：删除 shared 中无消费方的 `claude-sdk-schema/`、`codex-schema/`、`ideMetadata.ts`、
  `session/SessionView.ts`、`projectId.ts`、`app-types.ts`（约 2400 行）。仍在用的两样搬到含义
  对应的位置：`InputRequest` 进 `session/StoredSession.ts`（会话契约），`getModelContextWindow`
  进新文件 `context-window.ts`。删掉 `types.ts` 里重复的 `SessionOwnership` 与 `FileMetadata`/
  `FileContentResponse`/`PatchHunk`/`EditAugment`，`upload.ts` 只留 `UploadedFile`，`library.ts`
  删 `SharedReference`/`LibraryAudit`。shared 包改为 private（去掉 npm 发布配置）。规则、glossary、
  生成代码 hook 的提示同步。验证：全仓 typecheck、shared 19 个单测、biome 通过。
- 阶段 4：env schema 收齐 Hub 读取的全部变量（补 `ALLOWED_HOSTS`、`LOG_SDK_MESSAGES`、
  `CODEX_CORRELATION_DEBUG`、`SCHOLARAIO_HUB_UV`），子进程过滤名单由 schema 的键生成：去掉
  `MAINTENANCE_PORT`/`AUTH_DISABLED`/`PROXY_DEBUG`，不再按 `LOG_` 前缀误伤用户变量，原先漏掉的
  `IDLE_TIMEOUT`、`PERMISSION_MODE`、`ENABLED_PROVIDERS`、`HTTPS_SELF_SIGNED`、`CLIENT_DIST_DIR`、
  `ALLOWED_HOSTS` 不再泄漏给 agent。`config.ts` 去掉与 schema 重复的解析；两个调试日志器与 logger
  不再自己读 env 或调 `loadConfig`/`getDataDir`；`data-dir.ts` 并入 `runtime/profile.ts` 的
  `currentProfile()`。`createApp` 的 `dataDir` 必填，不再改全局；代理库绑定只在 `index.ts` 做一次
  （证书生成移回启动的 try 内）。library 代理白名单删掉被 projects 路由覆盖的两条和前端从不请求的
  五条，去掉类型补丁。删除 vitest 配置里指向不存在目录的 `ALLOW_SOCKET_TESTS`。
- 阶段 5：shared 新增 `csrf.ts` 的 `CSRF_HEADER`，server 中间件据它校验；前端 `core/http.ts` 提供
  `hubHeaders()`，`requestJson`、XHR 上传、首条消息提交、聊天流式传输都经它加头，不再各自拼字面量。
  验证：全仓 typecheck、client 182 / server 248 个单测、biome 通过；暂存区快照单独 tsc + 测试通过。
