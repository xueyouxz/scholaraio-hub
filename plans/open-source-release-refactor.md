# Refactor Plan: scholaraio-hub 开源发布全面优化

## 当前状态

一个功能完整、内部运转正常的 pnpm monorepo，但面向公开开源发布时存在多类问题：版本管理
bug、CI 低效、TypeScript 配置不完整、前端 bundle 未优化、开源基础设施缺失。核心逻辑无需
重写，所有改动均为配置/基础设施层面。

## 目标状态

- 版本号正确传递、发布流水线自动化完整（npm + GHCR + GitHub Release）
- TypeScript 严格覆盖所有文件（含 server 测试文件）
- 前端初始 bundle 减少 40-60%（路由懒加载 + vendor 分包）
- 一条命令可启动（`docker compose up` / `npx scholaraio-hub`），零歧义依赖
- 符合开源社区标准的项目结构（LICENSE、CONTRIBUTING、CHANGELOG、issue 模板）

---

## 受影响文件

| 文件 | 变更类型 | 所属阶段 |
|------|---------|---------|
| `package.json` | 修改 | Phase 1 |
| `packages/server/package.json` | 修改 | Phase 1 |
| `packages/shared/package.json` | 修改 | Phase 1 |
| `packages/client/package.json` | 修改 | Phase 1 |
| `packages/server/tsconfig.json` | 修改 | Phase 1 |
| `packages/client/tsconfig.json` | 修改 | Phase 1 |
| `.husky/pre-commit` | 修改 | Phase 1 |
| `scripts/check-commit-message.mjs` | 修改 | Phase 1 |
| `packages/shared/src/gemini-schema/` | 删除 | Phase 1 |
| `packages/shared/src/opencode-schema/` | 删除 | Phase 1 |
| `.npmrc` | 新建 | Phase 1 |
| `scripts/dev.mjs` | 修改 | Phase 2 |
| `.github/workflows/ci.yml` | 修改 | Phase 2 |
| `.github/workflows/release.yml` | 修改 | Phase 2 |
| `Dockerfile` | 修改 | Phase 2 |
| `vite.config.ts` | 修改 | Phase 3 |
| `packages/client/tsconfig.json` | 修改 | Phase 3 |
| `packages/client/src/app/App.tsx` | 修改 | Phase 3 |
| `LICENSE` | 新建 | Phase 4 |
| `.env.example` | 修改 | Phase 4 |
| `CHANGELOG.md` | 修改 | Phase 4 |
| `README.md` | 修改 | Phase 4 |
| `CONTRIBUTING.md` | 新建 | Phase 4 |
| `docker-compose.yml` | 新建 | Phase 4 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 新建 | Phase 4 |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 新建 | Phase 4 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 新建 | Phase 4 |

---

## Phase 1 — 低风险快速修复

> 每项改动 ≤ 10 行，互不依赖，可单次提交或逐项 PR。预计耗时 1 小时。

### 1.1 修复版本号 Bug

**问题：** 根 `package.json` 无 `version` 字段，`vite.config.ts` 中的 `resolveAppVersion()`
永远 fallback 到硬编码 `"0.0.1"`，无论打什么 tag，UI 版本号都不变。

**改动：**

```json
// package.json — 新增
"version": "0.1.0"
```

同时将四个包版本统一：

```
package.json              → "version": "0.1.0"
packages/server/package.json  → "version": "0.1.0"
packages/shared/package.json  → "version": "0.1.0"
packages/client/package.json  → "version": "0.1.0"
```

- [ ] 编辑 `package.json`
- [ ] 编辑 `packages/server/package.json`
- [ ] 编辑 `packages/shared/package.json`
- [ ] 编辑 `packages/client/package.json`
- [ ] **验证：** `pnpm build && grep "0\.1\.0" packages/client/dist/assets/*.js | head -1`

---

### 1.2 修复 `pnpm test` 遗漏客户端

**问题：** 根 `scripts.test` 只跑 shared + server，客户端 7 个测试文件从不被 CI 执行。

**改动：**

```json
// package.json scripts.test
"test": "pnpm --filter @scholaraio-hub/shared test && pnpm --filter @scholaraio-hub/server test && pnpm --filter @scholaraio-hub/client test"
```

- [ ] 编辑 `package.json` `scripts.test`
- [ ] **验证：** `pnpm test` 输出中包含三个包的测试结果

---

### 1.3 修复 Server 测试文件不参与类型检查

**问题：** `packages/server/tsconfig.json` 排除了 `test/`，导致 30+ 个测试文件中的类型
错误被 `pnpm typecheck` 静默忽略。

**改动：**

```json
// packages/server/tsconfig.json
"include": ["src/**/*.ts", "test/**/*.ts"]
// "exclude" 中删除 "test"
```

- [ ] 编辑 `packages/server/tsconfig.json`
- [ ] **验证：** `pnpm --filter @scholaraio-hub/server typecheck`（如出现类型错误需随即修复）

---

### 1.4 修复 Client `tsconfig.json` 两个问题

**问题 A：** 缺少 `composite: true`，根 `tsconfig.json` 的 `references` 声明对 client 无效，
增量构建缓存完全失效。

**问题 B：** `include` 列出了四条具体路径，新建顶层目录（如 `src/utils/`）会被类型检查
静默跳过。

**改动：**

```json
// packages/client/tsconfig.json compilerOptions
"composite": true

// include — 简化为
"include": ["src"],
"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
```

- [ ] 编辑 `packages/client/tsconfig.json`
- [ ] **验证：** `pnpm --filter @scholaraio-hub/client typecheck`

---

### 1.5 减轻 Pre-commit Hook

**问题：** `.husky/pre-commit` 跑全量 `pnpm typecheck`（先构建 shared，再检查三个包）加
`pnpm test`，每次提交阻塞 30-60 秒，推动开发者用 `--no-verify` 绕过，反而失去保护。

**改动：**

```sh
# .husky/pre-commit — 修改后（只保留 lint-staged）
pnpm exec lint-staged
```

typecheck 和 test 属于 CI 职责，不属于本地提交门控。

- [ ] 编辑 `.husky/pre-commit`，删除 `pnpm typecheck` 和 `pnpm test` 两行
- [ ] **验证：** 修改任意文件后 `git commit`，hook 在 5 秒内完成

---

### 1.6 放宽 Commit Message 禁用词

**问题：** `scripts/check-commit-message.mjs` 禁止 `claude`、`codex`、`ai` 等词，但这些
恰好是项目的核心技术名词。贡献者写 `"Fix Claude session reconnect"` 会被拒绝。

**改动：**

```js
// scripts/check-commit-message.mjs
// 原意是禁止"AI 生成内容声明"，不是禁止技术名词
const bannedPattern =
  /\b(generated|written|created)\s+(by|with|using)\s+(ai|chatgpt|gpt|claude|llm)\b/i;
```

- [ ] 编辑 `scripts/check-commit-message.mjs`
- [ ] **验证：** `echo "Fix Claude session reconnect" | node scripts/check-commit-message.mjs /dev/stdin` 不报错

---

### 1.7 统一 TypeScript 版本声明

**问题：** server/shared 的 `devDependencies` 声明 `"typescript": "^5.7.2"`，但根
`pnpm.overrides` 覆盖为 `^5.9.3`。两处声明共存造成误导，`^5.7.2` 从不生效。

**改动：** 从 server 和 shared 的 `devDependencies` 中删除 `typescript` 声明，由根
`pnpm.overrides` 统一提供。

- [ ] 编辑 `packages/server/package.json`：删除 `devDependencies.typescript`
- [ ] 编辑 `packages/shared/package.json`：删除 `devDependencies.typescript`
- [ ] **验证：** `pnpm install && pnpm typecheck`

---

### 1.8 删除 `shared` 中的死代码

**问题：** `packages/shared/src/gemini-schema/` 和 `opencode-schema/` 有实现代码，但未从
`index.ts` 导出，server 和 client 均未引用，却会进入 npm 发布产物（`files: ["dist"]`）。

- [ ] 删除 `packages/shared/src/gemini-schema/`
- [ ] 删除 `packages/shared/src/opencode-schema/`
- [ ] **验证：** `pnpm --filter @scholaraio-hub/shared build && pnpm typecheck`

---

### 1.9 移除 Tailwind 重复声明

**问题：** `@tailwindcss/vite` 和 `tailwindcss` 同时出现在根 `package.json` 和
`packages/client/package.json` 的 devDependencies 中。Vite 配置在根目录，由根提供即可。

- [ ] 编辑 `packages/client/package.json`：从 `devDependencies` 删除 `@tailwindcss/vite`、`tailwindcss`
- [ ] **验证：** `pnpm --filter @scholaraio-hub/client dev` 启动正常

---

### 1.10 新建 `.npmrc`

```ini
# .npmrc
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] 新建 `.npmrc`
- [ ] **验证：** `pnpm install` 无新增警告

---

### Phase 1 总验证

```bash
pnpm install
pnpm typecheck   # 现在包含 server test/ + client 全目录
pnpm test        # 现在包含 client 测试
pnpm build
```

---

## Phase 2 — CI/CD 与部署基础设施

> 影响 GitHub Actions、Docker、发布流程。预计耗时 2 小时。

### 2.1 拆分 CI Job，增加并行和 Playwright 缓存

**问题：** 当前 `ci.yml` 是一个串行 `validate` job（lint→typecheck→test→e2e），无法并行，
且每次 CI 都重新下载 ~180MB 的 Playwright Chromium。

**改动：**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.27.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.27.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.27.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  e2e:
    needs: [lint, typecheck, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.27.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('**/package.json') }}
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm --filter @scholaraio-hub/client build
      - run: pnpm test:e2e
```

- [ ] 重写 `.github/workflows/ci.yml`
- [ ] **验证：** Push 一个 PR，GitHub Actions 显示 lint/typecheck/test 三个并行 job，e2e 在其后运行

---

### 2.2 精简 Release Workflow，补全 GitHub Release 和 Docker 发布

**问题：** 当前 `release.yml` 重复跑全量 CI（浪费双倍时间），不创建 GitHub Release，不推送
Docker 镜像到 GHCR。

**改动：**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.27.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Publish to npm
        run: pnpm -r publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

  docker:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] 重写 `.github/workflows/release.yml`
- [ ] **验证：** 推送 `v0.1.0-rc.1` tag，检查 npm、GitHub Releases 页面、GHCR 三处均有产物

---

### 2.3 修复 Dockerfile：多阶段构建 + HOST 默认值

**问题：**
- 单阶段构建将 devDependencies 全部打入镜像，体积约为最优的 3-5 倍
- `HOST` 未设默认值，运行时继承 `127.0.0.1`，`docker run -p 3400:3400` 无法从宿主机访问

**改动：**

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json biome.json ./
COPY packages/client/package.json  ./packages/client/package.json
COPY packages/server/package.json  ./packages/server/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json  ./packages/server/
COPY packages/shared/package.json  ./packages/shared/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages/server/dist  ./packages/server/dist
COPY --from=builder /app/packages/shared/dist  ./packages/shared/dist
COPY --from=builder /app/packages/client/dist  ./packages/client/dist
EXPOSE 3400
CMD ["pnpm", "--filter", "@scholaraio-hub/server", "start"]
```

- [ ] 重写 `Dockerfile`
- [ ] **验证：**
  ```bash
  docker build -t scholaraio-hub:test .
  docker run --rm -p 3400:3400 scholaraio-hub:test
  # 浏览器访问 http://localhost:3400 应返回前端页面
  ```

---

### 2.4 修复 `scripts/dev.mjs`：可选启动 scholaraio

**问题：** `pnpm dev` 无条件执行 `scholaraio serve`，但 `scholaraio` 不是公开的 npm 包，
未安装时 warning 后继续运行，导致用户困惑 `/api/scholar/*` 路由为何失败。

**改动：**

```js
// scripts/dev.mjs — scholaraio 改为可选
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const whichCmd = isWindows ? "where" : "which";
const hasScholaraio =
  spawnSync(whichCmd, ["scholaraio"], { stdio: "ignore" }).status === 0;

if (hasScholaraio) {
  spawnChild("scholaraio", ["serve"], "scholaraio", { env: scholarEnv });
} else {
  console.log(
    "[scholaraio] not installed — /api/scholar/* routes will be unavailable.",
  );
  console.log(
    "[scholaraio] see: https://github.com/ZimoLiao/scholaraio",
  );
}
```

- [ ] 编辑 `scripts/dev.mjs`
- [ ] **验证：** 在未安装 scholaraio 的环境中 `pnpm dev` 正常启动，控制台显示友好提示而非 crash

---

### Phase 2 总验证

```bash
# 本地 Docker 测试
docker build -t scholaraio-hub:local .
docker run --rm -p 3400:3400 \
  -v "${HOME}/.claude:/root/.claude:ro" \
  scholaraio-hub:local
```

---

## Phase 3 — Vite 构建优化

> 影响客户端构建产物大小和加载性能。预计耗时 1.5 小时。

### 3.1 修改 `vite.config.ts`

**改动要点：**
- `sourcemap: false`（生产构建不暴露源码，不膨胀 dist 体积）
- `resolve.alias: { "@": ... }`（路径别名，消除深层相对导入）
- `build.target: "es2022"`（明确构建目标）
- `build.rollupOptions.output.manualChunks`（vendor 分包，提高缓存命中率）

```ts
// vite.config.ts — build 和 resolve 节完整替换
resolve: {
  alias: {
    "@": path.resolve(__dirname, "packages/client/src"),
  },
},
build: {
  outDir: path.resolve(__dirname, "packages/client/dist"),
  emptyOutDir: true,
  sourcemap: isDev ? true : (process.env.SOURCEMAP === "true" ? "hidden" : false),
  target: "es2022",
  chunkSizeWarningLimit: 600,
  rollupOptions: {
    output: {
      manualChunks: {
        "vendor-react": ["react", "react-dom", "react-router-dom"],
        "vendor-query": ["@tanstack/react-query"],
        "vendor-pdf":   ["react-pdf", "pdfjs-dist"],
        "vendor-viz":   ["d3"],
        "vendor-md":    [
          "react-markdown", "remark-gfm", "remark-math",
          "rehype-katex", "rehype-raw", "katex",
        ],
      },
    },
  },
},
```

- [ ] 编辑 `vite.config.ts`（新增 `resolve.alias`，替换 `build` 节）
- [ ] **验证：** `pnpm build`，确认 `dist/assets/` 中出现 `vendor-react-*.js`、`vendor-pdf-*.js` 等独立 chunk

---

### 3.2 更新 `packages/client/tsconfig.json`：加入路径别名声明

```json
// packages/client/tsconfig.json compilerOptions 中新增
"paths": {
  "@/*": ["./src/*"]
}
```

- [ ] 编辑 `packages/client/tsconfig.json`
- [ ] **验证：** `pnpm --filter @scholaraio-hub/client typecheck`（新 paths 不影响现有代码，待后续按需迁移）

---

### 3.3 `App.tsx` 路由级懒加载

**问题：** 所有路由页面静态导入，无论用户访问哪个路由，首次加载都下载完整的
pdfjs（~900KB gzip）+ D3（~200KB）+ KaTeX（~110KB）。

**策略：** 三个重型路由改为 `React.lazy`；其余轻量页面（ProjectsPage、SessionPage 等）
保持同步导入。

```tsx
// packages/client/src/app/App.tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NavigationLayout } from "./components/NavigationLayout";
// 轻量页面 — 同步导入
import { AgentsPage }    from "./pages/AgentsPage";
import { FilePage }      from "./pages/FilePage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { ProjectsPage }  from "./pages/ProjectsPage";
import { SessionPage }   from "./pages/SessionPage";
import { SettingsPage }  from "./pages/SettingsPage";

// 重型页面 — 懒加载（D3 + KaTeX + pdfjs 不进入初始 bundle）
const LibraryPage = lazy(() =>
  import("../features/library/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const PaperReaderPage = lazy(() =>
  import("../features/library/reader/PaperReaderPage").then((m) => ({
    default: m.PaperReaderPage,
  })),
);
const SearchPage = lazy(() =>
  import("../features/search/SearchPage").then((m) => ({ default: m.SearchPage })),
);

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-xs font-mono text-on-surface-variant animate-pulse">加载中…</span>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<NavigationLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/new-session" element={<NewSessionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/projects/:projectId/sessions/:sessionId" element={<SessionPage />} />
          <Route
            path="/library"
            element={<Suspense fallback={<PageFallback />}><LibraryPage /></Suspense>}
          />
          <Route
            path="/library/:paperId"
            element={<Suspense fallback={<PageFallback />}><PaperReaderPage /></Suspense>}
          />
          <Route
            path="/search"
            element={<Suspense fallback={<PageFallback />}><SearchPage /></Suspense>}
          />
        </Route>
        <Route path="/projects/:projectId/file" element={<FilePage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] 编辑 `packages/client/src/app/App.tsx`
- [ ] **验证（三步）：**
  1. `pnpm build` — 检查产物中 `vendor-pdf` chunk 体积大但独立存在
  2. 浏览器访问 `/projects` — Network 面板中 `vendor-pdf-*.js` **未加载**
  3. 切换到 `/library/:id` PDF tab — `vendor-pdf-*.js` **按需加载**

---

### Phase 3 总验证

```bash
pnpm build
# 列出前 10 个最大 chunk
ls -lh packages/client/dist/assets/*.js | sort -k5 -rh | head -10
# 预期：vendor-pdf 最大但独立，初始 chunk < 300KB gzip
```

---

## Phase 4 — 开源发布基础设施

> 面向外部用户的文档、许可证、发布规范。预计耗时 2 小时。

### 4.1 添加 MIT License

```
LICENSE（MIT）
Copyright (c) 2026 xueyou zhang
```

- [ ] 新建 `LICENSE` 文件
- [ ] **验证：** GitHub 仓库首页出现 MIT license 标识

---

### 4.2 补全 `.env.example`

当前仅 6 个变量，`packages/server/src/env.ts` 中定义了 20+ 个。按类别补全，每个变量加注释，
标注必填/可选/默认值，对应关系以 `env.ts` 的 `RuntimeEnvSchema` 为准。

分组结构：
- 服务器（PORT / HOST / NODE_ENV）
- 数据目录（SCHOLARAIO_HUB_DATA_DIR / SCHOLARAIO_HUB_PROFILE）
- Claude 集成（CLAUDE_CONFIG_DIR / CLAUDE_SESSIONS_DIR / CLAUDE_PROJECTS_DIR）
- Codex 集成（CODEX_SESSIONS_DIR / CODEX_WATCH_PERIODIC_RESCAN_MS）
- Provider 控制（ENABLED_PROVIDERS）
- 权限（PERMISSION_MODE）
- 性能（MAX_WORKERS / IDLE_TIMEOUT / MAX_UPLOAD_SIZE_MB / MAX_QUEUE_SIZE）
- 日志（LOG_LEVEL / LOG_FILE_LEVEL / LOG_TO_FILE / LOG_PRETTY / LOG_DIR）
- 网络（HTTPS_SELF_SIGNED）
- Scholar 代理（SCHOLARAIO_API_URL）

- [ ] 编辑 `.env.example`
- [ ] **验证：** 对照 `packages/server/src/env.ts` 的 `RuntimeEnvSchema` 确认无遗漏

---

### 4.3 规范化 `CHANGELOG.md`（Keep a Changelog 格式）

当前内容只有 3 行未分版本的 unreleased 条目。重写为标准格式：

```markdown
# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

## [0.1.0] - 2026-05-22
### Added
- Initial open-source release based on ScholarAIO
- Claude Code and OpenAI Codex session management UI
- Library analytics panel with D3 visualizations (scatter plot, heatmap, histogram)
- PDF reader for research papers
- Remote access via relay server
### Changed
- Restructure as pnpm workspace monorepo
- Standardize toolchain: TypeScript 5.9, Biome, Vitest, Playwright

[Unreleased]: https://github.com/OWNER/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0
```

- [ ] 重写 `CHANGELOG.md`

---

### 4.4 重写 `README.md` 用户章节

当前 README 从第 1 行直接讲 monorepo 结构，假设读者已知这是什么项目。在现有内容之前
插入面向用户的章节（不删除现有开发文档）：

新增章节顺序：
1. 项目介绍（一段话：这是什么、解决什么问题）
2. 截图 / Demo GIF（可先用占位符）
3. 快速开始（三个并列路径：npx / Docker / docker compose）
4. 功能列表
5. 依赖说明（claude CLI 推荐安装；codex CLI 可选；scholaraio serve 可选增强）
6. —— 分隔线 ——
7. 现有开发文档（保持不变，从"环境要求"开始）

- [ ] 编辑 `README.md`，在现有内容前插入用户章节

---

### 4.5 新建 `CONTRIBUTING.md`

内容：
- 开发环境配置（Node.js 版本、pnpm 安装）
- 首次设置步骤
- 代码风格（Biome，运行 `pnpm lint:fix`）
- 测试要求（提 PR 前需通过 `pnpm test`）
- Commit 规范（imperative，50 字符以内 subject）
- PR 流程

- [ ] 新建 `CONTRIBUTING.md`

---

### 4.6 新建 `docker-compose.yml`

```yaml
services:
  hub:
    image: ghcr.io/OWNER/scholaraio-hub:latest
    ports:
      - "3400:3400"
    environment:
      HOST: 0.0.0.0
      NODE_ENV: production
    volumes:
      - "${HOME}/.claude:/root/.claude:ro"
      - hub-data:/root/.scholaraio-hub
    restart: unless-stopped

volumes:
  hub-data:
```

- [ ] 新建 `docker-compose.yml`
- [ ] **验证：** `docker compose pull && docker compose up` 启动成功，访问 `http://localhost:3400`

---

### 4.7 新建 GitHub 社区文件

```
.github/
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml
│   └── feature_request.yml
└── PULL_REQUEST_TEMPLATE.md
```

`bug_report.yml` 包含：描述、复现步骤、预期行为、环境信息（OS / Node 版本 / 安装方式）。
`feature_request.yml` 包含：问题描述、建议方案、替代方案。
`PULL_REQUEST_TEMPLATE.md` 包含：变更摘要、测试方式、截图（UI 变更时）。

- [ ] 新建三个文件

---

### Phase 4 总验证（发布预检清单）

```bash
# 文件存在性检查
ls LICENSE CONTRIBUTING.md docker-compose.yml
ls .github/ISSUE_TEMPLATE/bug_report.yml
ls .github/ISSUE_TEMPLATE/feature_request.yml
ls .github/PULL_REQUEST_TEMPLATE.md

# 版本号贯通验证
grep '"version"' package.json packages/*/package.json

# .env.example 覆盖率
wc -l .env.example   # 应 > 40 行

# CHANGELOG 格式校验（手动检查有版本号和日期）
head -20 CHANGELOG.md
```

---

## 回滚方案

所有改动均为独立文件修改，按 git 粒度精确回滚：

```bash
# 回滚单个文件
git checkout HEAD~1 -- <file>

# 回滚某个阶段的全部提交（如 Phase 3 构建优化有问题）
git revert <phase-3-commit-range>

# Phase 3 紧急回滚（如生产构建异常）
git checkout HEAD~1 -- vite.config.ts packages/client/src/app/App.tsx
pnpm build   # 验证旧配置仍可构建

# Phase 2 Dockerfile 紧急回滚
git checkout HEAD~1 -- Dockerfile
docker build -t scholaraio-hub:rollback .
```

---

## 风险评估

| 阶段 | 风险项 | 概率 | 应对 |
|------|--------|------|------|
| 1.3 | server test/ 中暴露已有类型错误 | 中 | typecheck 失败时逐文件修复，不阻塞其他项 |
| 1.4 | client composite 触发 tsbuildinfo 格式问题 | 低 | `pnpm clean && pnpm build` 重置 |
| 2.3 | 多阶段 Dockerfile prod 依赖安装不完整 | 中 | 本地 `docker build + docker run` 先验证 |
| 3.3 | 懒加载 chunk 边界错误导致路由白屏 | 低 | E2E smoke test 覆盖 /library 路由 |
| 3.3 | SearchPage 与 library 组件共享导致 chunk 过大 | 低 | 构建后检查 vendor-viz chunk 大小 |
| 4.2 | .env.example 漏掉某些变量 | 低 | 以 `env.ts` RuntimeEnvSchema 为权威对照 |

---

## 建议执行顺序与时间估算

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4
 ~1 小时     ~2 小时     ~1.5 小时    ~2 小时

总计约 6-7 小时，建议拆为 4 个独立 PR 合并。
```

**Phase 1 可立即开始**：改动量最小、风险最低、收益最高（修复测试遗漏和类型检查盲区）。
**Phase 3 依赖 Phase 1**：client tsconfig 的 `composite` 修复需在 Vite alias 配置前完成。
**Phase 4 可与 Phase 2/3 并行**：文档改动与代码无依赖关系。
