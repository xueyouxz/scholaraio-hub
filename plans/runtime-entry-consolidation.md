# 重构计划：运行入口、端口与部署收敛

## 背景

Hub 的「部署」就是本机源码 checkout 后启动：Node 服务端 + 构建好的前端 + 数据目录里的
Python 运行环境。这一层很薄，但同一条规则散落在多处实现，每次修 bug 只修到其中一份。
2026-09-24 的 MinerU 故障就是例子：`scholaraio-cli.ts` 给 agent 子进程把 venv 的 `bin`
放上了 PATH，`LibraryService` 没有，于是 `shutil.which("mineru-open-api")` 在 Python
服务里找不到已安装的 CLI，云端解析一直静默降级。

目标不是「能跑」，而是让入口、端口、数据目录、Python 运行环境各自只有一个定义点。

## 现状（改动前）

### 入口

| 入口 | 作用 | 问题 |
|---|---|---|
| `scripts/dev.mjs` | 开发：起 server + vite，端口/数据目录/预检 | 自己再实现一遍端口、数据目录、`.env` 读取、Python 路径 |
| `scripts/hub.mjs` | start / setup / doctor / migrate | 设 NODE_ENV/profile 后再绕 `pnpm --filter` 一层 |
| `packages/server/src/tools.ts` | setup / doctor / migrate 实现 | — |
| `packages/server/src/cli.ts` + `bin` + `publishConfig` | yepanywhere 遗留 CLI | 无人调用；宣传 `--host 0.0.0.0`、`MAINTENANCE_PORT`，与本地单用户安全模型冲突；npm 包只含 `dist`，运行时却要找仓库里的 Python 源码和前端产物，发布路径根本跑不通 |
| `scripts/release-web.mjs` | 「发布网站」 | 遗留，无引用 |
| `scripts/sync-scholaraio-skills.mjs` | 技能清单同步 | 自己推导数据目录，且不认 profile |

### 同一规则的多份实现

| 规则 | 位置 | 已发生的漂移 |
|---|---|---|
| 数据目录 | `data-dir.ts`、`dev.mjs`、`sync-scholaraio-skills.mjs` | skills 脚本只看 NODE_ENV |
| 端口 | `shared/ports.ts`、`dev.mjs`（写死 3500）、`cli.ts` 帮助、`.claude/launch.json` | launch.json 写成 3502（preview 端口） |
| `.env` 加载 | `env.ts`（6 层）、`dev.mjs`（2 层）、Vite `loadEnv` | 三套优先级 |
| Python 路径与 venv 激活 | `LibraryService`、`scholaraio-cli.ts`、`dev.mjs`、`tools.ts` | 只有一处加 PATH → MinerU 故障 |
| `uv sync` 依赖组 | `tools.ts`、`VectorRuntimeService`、`test-python.mjs` | 装过语义检索后重跑 setup，`uv sync` 精确同步会卸掉 topics/embed |

### 拓扑

- 开发两个 origin（3500 API + 3501 Vite 代理 `/api`、`/hub`、`/health`），生产一个 origin（3400）。
  `/hub` 代理已经没有对应路由。开发时 3500 还会用 `packages/client/dist` 提供一份过期的前端。
- NODE_ENV 与 `SCHOLARAIO_HUB_PROFILE` 两个旋钮都能决定数据目录和端口，「生产」有三种写法。

## 原则

1. 每条运行时规则只有一个定义点，其余地方调用它。
2. profile 是唯一的环境轴；NODE_ENV 由 profile 推导（vitest 的 `NODE_ENV=test` 仍强制测试隔离）。
3. 所有环境单 origin、单端口；用户和工具只看到一个地址。
4. Python 运行环境声明式：记录期望能力，安装只增不减，幂等。
5. 部署方式只有一种：源码 checkout + `pnpm build` + `pnpm start`。不保留半成品发布路径。

## 不做

- Docker / 容器化：AI 功能依赖用户本机已登录的 claude/codex CLI。
- 改 Python sidecar 通信（随机端口 + stdout 回报 + token）：设计正确。
- 公网/远程访问：见安全模型，需从头设计鉴权链。
- `test-python.mjs` 的测试清单维护方式：属测试基础设施，另行处理。

## 阶段

每阶段独立提交，只提交本计划涉及的改动；跑通对应验证后再进入下一阶段。
不 push、不开 PR。

### 阶段 1：Python 运行环境单一定义

新建 `packages/server/src/runtime/python.ts`：

```ts
pythonRuntime(dataDir) → {
  root,        // <dataDir>/runtime/python（UV_PROJECT_ENVIRONMENT）
  binDir,      // bin | Scripts
  executable,  // python | python.exe
  command(name),          // venv 内的 console script 路径
  env(base),              // 激活后的环境：binDir 置于 PATH 首位、VIRTUAL_ENV、去掉 PYTHONHOME
}
```

- `LibraryService`：用 `pythonRuntime(...).executable` 和 `.env()`，替换临时 PATH 补丁；删除 `libraryPythonPath`。
- `scholaraio-cli.ts`：用 `binDir` / `command("scholaraio")`。
- `tools.ts` 的 setup / doctor / migrate、`VectorRuntimeService`：路径全部取自该模块；migrate 子进程也用激活环境。
- `.claude/launch.json`：端口改为开发前端实际端口（阶段 4 后改为 3500）。

验收：
- 仓库中 `runtime/python`、`"runtime", "python"` 字面量只出现在 `runtime/python.ts`（及测试）。
- 单元测试覆盖 `env()` 的 PATH 顺序、VIRTUAL_ENV、win32 布局。
- server typecheck + 单元测试通过。

### 阶段 2：Python 运行环境声明式安装

在 `runtime/python.ts` 增加：

- 能力表：`core → [hub, mineru-cloud]`，`semantic → [topics]`（topics 已包含 embed）。
- 清单 `<dataDir>/runtime/manifest.json`：`{ "version": 1, "capabilities": ["semantic"] }`。
- `syncCommand(capabilities, uv)`：唯一的 `uv sync` 参数构造。
- `ensureCapabilities(dataDir, add)`：期望能力 = 清单 ∪ 新增；同步成功后写清单。
- 旧环境没有清单时一次性推断：venv 中能找到 `sentence_transformers` 即视为已有 semantic。

消费方：
- `setup`：按清单同步，不会卸掉已装能力。
- `VectorRuntimeService.install`：期望能力加上 semantic。
- `doctor`：打印清单能力与 Python 可用性。

验收：
- 单元测试：参数构造、清单合并、无清单推断。
- 在开发数据目录（已装 semantic）执行 setup，uv 输出不出现卸载 torch / sentence-transformers。

### 阶段 3：单一 CLI 入口与脚本收敛

- `packages/server/src/cli/`：`index.ts` 分发 `dev | setup | doctor | migrate | skills-sync`，
  取代 `tools.ts`、`scripts/dev.mjs`、`scripts/sync-scholaraio-skills.mjs` 的实现。
- `runtime/profile.ts`：`resolveProfile(env)` 给出 profile、NODE_ENV、数据目录、端口，
  `data-dir.ts`、`config.ts`、dev 启动器都调用它。端口默认值按 profile 决定。
- `.env` 加载只有 `env.ts` 一处；dev 启动器复用它。文件层级收敛为
  `.env`、`.env.local`、`.env.<profile>`、`.env.<profile>.local`。
- `scripts/hub.mjs` 只做引导：把 `--production` / `--profile <name>` 转成环境变量；
  `start` 直接 `node packages/server/dist/index.js`（缺产物时提示先 `pnpm build`），其余命令用 tsx 执行 CLI。
- 根脚本：`dev`、`start`、`hub`（`pnpm hub setup|doctor|migrate|skills-sync`），
  去掉与 pnpm 内置命令同名的 `setup`/`doctor`，去掉 `migrate`、`skills:sync`、`release:web`。
- 删除：`packages/server/src/cli.ts`、server 的 `bin` / `publishConfig`（改 `private: true`）、
  server 的 `dev` / `start` 脚本、`scripts/dev.mjs`、`scripts/release-web.mjs`、`scripts/sync-scholaraio-skills.mjs`。
- 服务端启动失败信息：端口占用、生产缺前端产物时直接失败并给出下一步。
- 脚本卫生：`test:e2e` 自己先构建 shared（同步删除 CI 中单独的构建步骤）；`clean` 补上 client 的 tsbuildinfo。
- 文档：README、CONTRIBUTING、`.env.example`、`.claude/topics/ci-and-local-verification.md`。

验收：
- `pnpm hub doctor`、`pnpm hub doctor --production` 输出正确的数据目录与端口。
- `pnpm dev` 行为与改动前一致（阶段 4 前仍是两个进程）。
- 数据目录、端口推导在仓库中各只有一个实现。
- lint + typecheck + 单元测试通过。

### 阶段 4：开发单 origin（Vite 中间件模式）

- `packages/server/src/frontend/dev.ts`：开发 profile 下以 `middlewareMode` 创建 Vite，
  HMR 挂在同一个 HTTP server 上；`/api/*`、`/health` 交给 Hono，其余交给 Vite。
  生产仍由 `frontend/static.ts` 提供构建产物。
- `vite.config.ts` 只保留构建与插件配置，删除 dev server 端口、代理、preview。
- `shared/ports.ts` 只保留应用端口；删除 `CLIENT_PORT`、`CLIENT_PREVIEW_PORT`。
- 删除 `pnpm dev:server` / `dev:client`、client 包的 `dev` / `preview` 脚本；dev 启动器只剩预检 + `tsx watch`。
- `.claude/launch.json` 改为 3500。

代价：服务端代码变动触发 `tsx watch` 重启时 Vite 随之重启（依赖预构建有磁盘缓存，约 1–2 秒，
页面自动重连刷新）；只改前端时 HMR 不受影响。

验收：
- 浏览器打开 `http://127.0.0.1:3500`：页面、API、CSRF 头、会话流式、HMR 均正常。
- 修改前端文件触发 HMR 更新而不整页刷新；修改服务端文件后页面自动恢复。
- 仓库中不再出现 3501/3502 与 `CLIENT_PORT`。

## 风险与回滚

- 每阶段一个提交，可单独 revert。
- 工作区有大量与本计划无关的未提交改动；提交时只暂存本计划的改动块。
- 浏览器 e2e 会重建 `packages/client/dist`，而正在运行的生产服务（3400）直接读取该目录，
  因此浏览器 e2e 放到最后、在用户确认后再跑。

## 进度

- [x] 阶段 1：`runtime/python.ts` 定义运行环境位置与激活环境；LibraryService、agent CLI 注入、setup/doctor/migrate、向量安装、浏览器测试服务器改用它。`scripts/dev.mjs` 的副本随阶段 3 删除。
- [x] 阶段 2：`runtime/install.ts` 的 `planRuntimeSync` 是唯一的运行环境安装入口，清单记在 `<dataDir>/runtime/manifest.json`；旧环境首次同步时探测 `sentence_transformers`。实测开发与生产数据目录均识别为 semantic，`uv sync --dry-run` 为「无变化」，而旧 setup 参数会卸载 49 个包（含 torch、sentence-transformers）。浏览器测试服务器用 `uvSyncCommand`；`scripts/test-python.mjs` 仍自带参数（测试环境，另装 hub-test）。
- [x] 阶段 3：`scripts/hub.mjs` 是唯一入口（`pnpm dev` / `pnpm start` / `pnpm hub <命令>`），命令实现在 `packages/server/src/cli/`；`runtime/profile.ts` + `shared` 的 `resolveProfileName` 决定数据目录、端口与默认 NODE_ENV，端口默认值改按 profile（无 profile 且无 NODE_ENV 时由 3400 改为 dev 的 3500，与数据目录一致）。env 文件改为 `.env`、`.env.local`、`.env.<profile>`、`.env.<profile>.local`。删除 yepanywhere CLI、`dev.mjs`、`release-web.mjs`、技能同步脚本；server 包改 private。生产缺前端产物、端口占用时启动直接失败并提示。已实测 doctor 三种 profile、`pnpm dev` 启停、构建产物的两种失败提示与正常启动。
- [ ] 阶段 4
