# 参与开发

使用说明见 [README](README.md)，架构见 [docs/architecture.md](docs/architecture.md)。用 coding agent
开发时，它读取的规则在 [AGENTS.md](AGENTS.md)；这些规则对人同样适用。

## 准备

- Node.js 20+
- pnpm 10.27+（`corepack enable` 即可使用仓库固定的版本）
- [uv](https://docs.astral.sh/uv/getting-started/installation/)，用于安装 Python 文献服务的运行环境

```bash
git clone https://github.com/xueyouxz/scholaraio-hub.git
cd scholaraio-hub
pnpm install
pnpm hub setup                              # Python 运行环境装进 dev profile 的数据目录
pnpm exec playwright install chromium       # 浏览器测试，只需一次
```

可选的本地配置写在 `.env.local`，可用项见 [.env.example](.env.example)。

## 开发

```bash
pnpm dev             # http://127.0.0.1:3500
PORT=3800 pnpm dev   # 换端口
```

开发服务器在同一个端口上提供 API，并以中间件模式运行 Vite，页面、API 和前端热更新同源，与生产一致。
前端直接读取 `packages/shared` 源码，修改共享类型无需重新构建；修改服务端代码时进程会重启，页面自动重连。
启动前会检查端口占用和文献运行环境。`pnpm hub doctor` 显示当前 profile 对应的数据目录和端口。

其他命令：`pnpm hub skills-sync` 找出 skills 目录里 `packages/server/src/skills/scholaraioCategories.ts` 尚未收录的 skill，追加到文件末尾的注释块，供维护者归类。

## 验证

推送前在本地跑完整门禁，与 CI（`.github/workflows/ci.yml`）一致：

```bash
pnpm ci:local
```

它依次执行 lint（Biome + `scripts/check-conventions.mjs`）、类型检查、Python 测试、单元测试、服务端 e2e 和浏览器
e2e。单独运行：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:python`、`pnpm test:e2e`。

以下两组测试会调用本机已登录的 CLI、发送真实模型请求，只在需要时手动运行：

```bash
pnpm --filter @scholaraio-hub/server test:e2e:real
REAL_HUB_TESTS=true REAL_HUB_PROVIDER=codex pnpm --filter @scholaraio-hub/server exec vitest run test/e2e/workbench-real.test.ts
```

`pnpm build` 会覆盖生产使用的 `dist/`；生产实例正在运行时，先确认再重建。

## 代码规范

- 格式和 lint 由 Biome 负责，提交时 pre-commit 钩子对暂存文件运行 `lint-staged`。
- `scripts/check-conventions.mjs` 拒绝 suppression 注释、吞掉错误的空 catch，以及放错位置的测试文件。
- 各包的具体规则在 `.claude/rules/`（client / server / shared / python），UI 以 [.design/DESIGN.md](.design/DESIGN.md) 为准。

## 提交与 PR

- 提交标题简短、祈使句、具体，例如 `Add session pagination for Codex provider`；避免 `Fix bug` 这类笼统标题。
  commit-msg 钩子会拒绝 AI 署名行。
- 从 `main` 拉分支，附上相应测试，推送前 `pnpm ci:local` 通过。
- PR 按模板填写：改了什么、为什么、如何验证；界面改动附截图；新增环境变量或配置（`PORT`、`SCHOLARAIO_HUB_*`）要写明。

## 目录

```
packages/
  client/      # Vite + React 前端
  server/      # Hono API、会话监管、provider、`pnpm hub` 命令
  shared/      # 共享类型、schema、profile 与端口规则
  scholaraio/  # Python 文献服务（sidecar）
scripts/       # hub.mjs 入口、CI 与规范检查
e2e/           # Playwright 浏览器测试
docs/          # 架构说明
```
