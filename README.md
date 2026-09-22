# ScholarAIO Hub

管理本地文献的个人工作台：导入 PDF、浏览和全文检索、阅读原文，并通过 Claude Code 或 Codex 围绕文献提问。回答引用可跳回对应原文片段。

文献与应用会话保存在本机。AI 请求会将本轮输入和检索到的有限文献片段交给所选 CLI，遵循该 CLI 的模型服务配置。

## 启动

需要 Node.js 20+、pnpm 10+、[uv](https://docs.astral.sh/uv/getting-started/installation/)。AI 功能另需安装并登录 Claude Code 或 Codex；仅管理和阅读文献不要求 AI 登录。无需全局安装 ScholarAIO，也无需启用向量模型。

```sh
pnpm install
pnpm run setup --production
pnpm build
pnpm start
```

打开 http://localhost:3400 。Node 同时提供页面、API，并管理仅监听本机动态端口的 Python 服务。停止 Node 会关闭该服务。

开发时使用独立环境：

```sh
pnpm run setup
pnpm dev
```

`pnpm dev` 同时启动 Node 服务（3500，tsx 热重载）和 Vite 前端（3501，`/api` 代理到服务端）：先检查端口占用和文献运行环境，服务端 `/health` 就绪后再启动前端；日志按 `[server]` / `[client]` 前缀输出，任一进程退出或 Ctrl+C 会同时停止两者。前端开发时直接读取 `packages/shared` 源码，修改共享类型无需重新构建。

```sh
pnpm dev             # 前后端联调，浏览器打开 http://127.0.0.1:3501
pnpm dev:server      # 只启动服务端
pnpm dev:client      # 只启动前端，代理到已运行的服务端
PORT=3800 pnpm dev   # 换端口（前端自动使用 3801）
```

端口可通过 `PORT` / `CLIENT_PORT` 覆盖，默认值统一来自 `packages/shared/src/ports.ts`。

浏览器测试使用独立临时数据目录和默认端口 3600，可与默认开发、生产服务同时运行；显式设置 `PORT` 时使用指定端口。

**setup 和 doctor 请加 `run`**：`pnpm setup`、`pnpm doctor` 是 pnpm 自身的内置命令，不会执行项目的同名脚本。

```sh
pnpm run doctor                 # 开发环境检查
pnpm run doctor --production    # 生产环境检查
```

诊断检查数据目录、端口、Python、CLI 可执行性及本地登录状态。远端撤销的令牌只能在实际请求时发现；Claude 可用 `claude auth login` 重新登录，Codex 使用 `codex login`。

## 数据与配置

- 正式环境：`~/.scholaraio-hub`
- 开发环境：`~/.scholaraio-hub-dev`
- 测试：独立临时目录
- `SCHOLARAIO_HUB_DATA_DIR` 可指定绝对路径，优先于默认目录。

数据目录保存 `data/` 文献与索引、`workspace/`、`sessions/` 应用会话、设置、日志、`backups/` 迁移记录及 `runtime/python/` 运行环境。应用配置见 [.env.example](.env.example)。CLI 的登录凭据和原生记录仍在 CLI 自己的目录，应用不自动扫描外部会话。

Python 依赖由 `packages/scholaraio/uv.lock` 锁定。更新依赖后重新执行对应环境的 setup。业务源码在仓库，运行数据不写回源码目录。

## 使用

1. 在文献库批量选择 PDF，或选择目录上传其中的 PDF。每批最多 500 个文件、500 MB；同文件按哈希去重。
2. 等待解析与索引完成，查看逐项结果；失败项可重试。扫描 PDF 暂无内置 OCR，仍可阅读原件，界面会标明不能全文检索。
3. 用关键词检索元数据和全文，点击结果阅读。PDF 支持页码跳转，全文支持片段定位，阅读位置自动保存。
4. 从阅读器选择“询问本文”，或在文献库多选后提问；直接新建会话则检索全库。有效引用跳转至 Markdown 行号，不推断 PDF 坐标。
5. 浏览器断开不会结束任务；刷新可恢复显示。停止按钮会中断服务端 CLI。切换 AI 工具需新建会话。
6. 在新会话页可选择 Claude / Codex JSONL 历史文件导入；导入记录只读。

默认以关键词检索提供上下文。保留的 ScholarAIO 向量检索源码可供后续增强，当前主流程不加载向量模型。标签笔记、回收站、引文插件、云同步和多人协作不在本轮范围内。

## 迁移旧文献

迁移不会随启动执行。先停止旧 ScholarAIO 和目标 Hub，准备生产运行环境，然后生成清单：

```sh
pnpm run setup --production
pnpm migrate --production plan --source /absolute/path/to/old-scholaraio --target /absolute/path/to/.scholaraio-hub
pnpm migrate --production apply --manifest /absolute/path/to/manifest.json
# 如需恢复，先停止目标应用，再执行：
pnpm migrate --production rollback --manifest /absolute/path/to/manifest.json
```

清单会列出目录、文件数、总大小与目标。工具先备份、校验 SHA-256，再移动用户数据、验证 UUID，最后切换配置并重建关键词索引。冲突或源文件变化会停止，绝不覆盖目标文献。备份独立保存在目标的 `backups/`；回滚遇到迁移后修改过的用户文件或配置也会停止，避免丢失新修改。旧代码、虚拟环境、缓存和临时运行文件不会迁移。迁移后请使用 Hub 启动命令，旧项目入口不会自动改写。

## 开发与验证

```sh
pnpm ci:local       # lint、类型、Python、单元和浏览器端到端检查
pnpm build
# 已登录 CLI 的真实多轮、重启恢复及中断验证（会发送模型请求）
REAL_HUB_TESTS=true REAL_HUB_PROVIDER=codex pnpm --filter @scholaraio-hub/server exec vitest run test/e2e/workbench-real.test.ts
```

浏览器测试首次需 `pnpm exec playwright install chromium`。架构与兼容说明见 [docs/library-workbench.md](docs/library-workbench.md)，实施验收记录见 [plans/library-workbench-implementation.md](plans/library-workbench-implementation.md)。

## 来源与许可

源于 [YepAnywhere](https://github.com/xueyouxz/yepanywhere) 与 [ScholarAIO](https://github.com/xueyouxz/scholaraio) 的二次开发。Python 源码来源与修改边界见 [UPSTREAM.md](packages/scholaraio/UPSTREAM.md)，保留原始许可与相关测试。

[MIT](LICENSE) © 2026 xueyou zhang
