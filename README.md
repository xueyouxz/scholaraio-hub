# scholaraio-hub 使用指南

本仓库是一个基于 `pnpm workspace` 的 monorepo，核心包统一放在 `packages/` 目录下：

- `client`：Vite 前端
- `server`：Node.js 服务端
- `shared`：共享类型、Schema 和工具函数

代码位置：

- 工作区与根脚本：`package.json`
- 包结构：`packages/client/package.json`、`packages/server/package.json`、`packages/shared/package.json`
- 共享端口规则：`packages/shared/src/ports.ts`
- 服务端运行时配置：`packages/server/src/config.ts`
- 环境变量加载：`packages/server/src/env.ts`
- 数据目录策略：`packages/server/src/data-dir.ts`

## 环境要求

- Node.js `>= 20`
- pnpm `>= 10.27.0`

如果本机还没有启用 pnpm，先执行：

```bash
corepack enable
```

代码位置：

- 版本约束：`package.json > engines`
- Docker 运行时：`Dockerfile`

## 1. 初始化项目

安装依赖：

```bash
pnpm install
```

建议初始化本地环境变量：

```bash
cp .env.example .env.local
```

如果需要跑 E2E，首次还需要安装 Playwright Chromium：

```bash
pnpm exec playwright install chromium
```

简要说明：

- `pnpm install` 会安装整个 workspace 的依赖。
- 如果当前目录是 Git 仓库，安装时也会触发 `husky` 的 `prepare`，自动准备 hooks。
- `.env.local` 会覆盖 `.env.example` 中的默认值。

代码位置：

- 安装后置动作：`package.json > scripts.prepare`
- 环境变量示例：`.env.example`
- Git hooks：`.husky/`
- Playwright 配置：`playwright.config.ts`

## 2. 启动开发环境

启动前后端开发服务：

```bash
pnpm dev
```

默认端口规则：

- 服务端 API：`3400`
- Vite 开发前端：`3401`
- Vite preview / E2E：`3402`

如果只改 `PORT=3500`，默认会自动变成：

- API：`3500`
- 前端开发：`3501`
- Preview：`3502`

简要说明：

- `pnpm dev` 会并行启动 `server` 和 `client`。
- 前端开发服务器会把 `/api` 和 `/health` 代理到服务端。
- 端口也可以分别用 `CLIENT_PORT`、`CLIENT_PREVIEW_PORT` 单独覆盖。

代码位置：

- 根启动脚本：`package.json > scripts.dev`
- 前端开发服务器和代理：`vite.config.ts`
- 端口派生规则：`packages/shared/src/ports.ts`
- 服务端配置读取：`packages/server/src/config.ts`

## 3. 构建项目

执行完整构建：

```bash
pnpm build
```

构建产物目录：

- `packages/shared/dist`
- `packages/server/dist`
- `packages/client/dist`

简要说明：

- `shared` 先构建，供 `server` 和 `client` 消费。
- `client` 使用根级 `vite.config.ts` 构建。
- 前端构建时会把 Git 短 SHA 注入版本号。

代码位置：

- 构建脚本：`package.json > scripts.build`
- 前端构建配置：`vite.config.ts`
- Docker 构建流程：`Dockerfile`

## 4. 清除构建产物

清除 `dist`、Playwright 报告和 TypeScript 增量文件：

```bash
pnpm clean
```

常见组合：

```bash
pnpm clean
pnpm build
```

简要说明：

- `pnpm clean` 不会删除 `node_modules`。
- 它只清理构建输出、测试报告和 `.tsbuildinfo`，适合“干净重建”。

代码位置：

- 清理入口：`package.json > scripts.clean`
- 清理实现：`scripts/clean.mjs`

## 5. 代码检查与测试

代码风格检查：

```bash
pnpm lint
```

类型检查：

```bash
pnpm typecheck
```

单元 / 集成测试：

```bash
pnpm test
```

E2E 测试：

```bash
pnpm test:e2e
```

生产依赖安全检查：

```bash
pnpm audit:prod
```

简要说明：

- `lint` 由 Biome 执行。
- `typecheck` 会先构建 `shared`，再检查 `server` 和 `client`。
- `test:e2e` 会先构建 `client`，再启动 preview 服务并跑 Chromium。

代码位置：

- 根质量脚本：`package.json > scripts.lint`、`scripts.typecheck`、`scripts.test`、`scripts.test:e2e`
- Biome 配置：`biome.json`
- 服务端测试入口：`packages/server/package.json > scripts.test`
- E2E 配置：`playwright.config.ts`

## 6. 生产启动

本地以生产模式运行：

```bash
pnpm build
NODE_ENV=production pnpm --filter @scholaraio-hub/server start
```

如果需要指定主机和端口：

```bash
HOST=0.0.0.0 PORT=3400 NODE_ENV=production pnpm --filter @scholaraio-hub/server start
```

简要说明：

- 生产模式默认数据目录是 `~/.scholaraio-hub/`
- 开发模式默认数据目录是 `~/.scholaraio-hub-dev/`
- 也可以用 `SCHOLARAIO_HUB_DATA_DIR` 显式覆盖

代码位置：

- 服务启动脚本：`packages/server/package.json > scripts.start`
- 数据目录规则：`packages/server/src/data-dir.ts`
- 运行时环境解析：`packages/server/src/env.ts`
- 运行时配置聚合：`packages/server/src/config.ts`

## 7. Docker 运行

构建镜像：

```bash
docker build -t scholaraio-hub .
```

运行容器：

```bash
docker run --rm -p 3400:3400 -e NODE_ENV=production scholaraio-hub
```

如果需要持久化数据目录，建议额外挂载卷并设置 `SCHOLARAIO_HUB_DATA_DIR`。

代码位置：

- 容器构建与启动：`Dockerfile`

## 8. 发布 npm 包

推荐流程：

1. 更新 `CHANGELOG.md`
2. 更新需要发布的包版本
3. 提交代码
4. 打标签并推送标签

示例：

```bash
git add -A
git commit -m "Release v0.0.2"
git tag v0.0.2
git push origin main --tags
```

简要说明：

- GitHub Actions 会在推送 `v*` 标签时执行发布流水线。
- 发布流水线会自动执行 `install`、`lint`、`typecheck`、`test`、`build`、`test:e2e`，然后运行 `pnpm -r publish`。
- 只有非 `private` 包会真正发布到 npm。

代码位置：

- 发布工作流：`.github/workflows/release.yml`
- CI 校验工作流：`.github/workflows/ci.yml`
- 包版本：`packages/server/package.json`、`packages/shared/package.json`
- 变更记录：`CHANGELOG.md`

## 9. 发布网站

如果你有独立的网站部署命令，可以直接复用：

```bash
DEPLOY_WEB_COMMAND="你的部署命令" pnpm release:web
```

简要说明：

- 该脚本会先执行 `pnpm build`
- 如果没有传入 `DEPLOY_WEB_COMMAND`，脚本只会完成构建，不会真的发布

代码位置：

- 网站发布脚本：`scripts/release-web.mjs`

## 10. 关键环境变量

最常用的变量：

```bash
PORT=3400
HOST=127.0.0.1
NODE_ENV=development
SCHOLARAIO_HUB_PROFILE=dev
SCHOLARAIO_HUB_DATA_DIR=/custom/path
LOG_LEVEL=info
LOG_PRETTY=true
```

简要说明：

- `SCHOLARAIO_HUB_PROFILE` 会把默认数据目录切到 `~/.scholaraio-hub-{profile}/`
- `SCHOLARAIO_HUB_DATA_DIR` 的优先级高于 profile
- `PORT` 会影响 API / client / preview 的派生端口

代码位置：

- 示例：`.env.example`
- 环境变量 Schema：`packages/server/src/env.ts`
- 数据目录规则：`packages/server/src/data-dir.ts`
- 端口派生：`packages/shared/src/ports.ts`

## 11. 深入阅读

如果需要了解服务端实现细节，可以继续看：

- `packages/server/README.md`
