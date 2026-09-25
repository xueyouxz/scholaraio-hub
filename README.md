# ScholarAIO Hub

管理本地文献的个人工作台：导入 PDF、浏览和全文检索、阅读原文，并通过 Claude Code 或 Codex 围绕文献提问。回答中的引用可以跳回原文对应片段。

文献和会话都保存在本机。提问时，应用只把本轮输入和检索到的少量文献片段交给所选 CLI，模型服务由该 CLI 自己的配置决定。

## 快速开始

需要 Node.js 20+、pnpm 10+ 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。AI 功能另需安装并登录 Claude Code 或 Codex；只管理和阅读文献则不需要。

```sh
pnpm install
pnpm hub setup --production
pnpm build
pnpm start
```

打开 http://localhost:3400 。Node 同时提供页面和 API，并在后台管理只监听本机的 Python 文献服务；停止 Node 时它会一起关闭。

检查运行环境（数据目录、端口、Python 依赖、CLI 是否可用及登录状态）：

```sh
pnpm hub doctor --production
```

本地登录有效不代表远端令牌未被撤销，需要时可用 `claude auth login` 或 `codex login` 重新登录。

## 使用

1. 在文献库选择多个 PDF 或一个目录导入。每批最多 500 个文件、500 MB；相同文件按哈希去重。
2. 等待解析和索引完成，查看每个文件的结果，失败的可以重试。扫描版 PDF 暂无内置 OCR：原件可以阅读，但不能全文检索，界面会标明。
3. 按关键词检索元数据和全文，点开结果阅读。PDF 支持页码跳转，全文支持片段定位，阅读位置自动保存。
4. 在阅读器里选「询问本文」，或在文献库多选后提问；直接新建会话则检索全库。引用跳转到 Markdown 行号，不推算 PDF 坐标。
5. 关闭浏览器不会中断任务，刷新即可恢复显示。停止按钮会中断服务端的 CLI。换用另一个 AI 工具需要新建会话。

默认用关键词检索提供上下文。语义检索是可选能力：在设置中安装运行时并为文献生成向量后启用。

暂不支持：标签笔记、回收站、引文插件、云同步和多人协作。

## 数据与配置

| profile | 数据目录 | 默认端口 | 用于 |
|---|---|---|---|
| `production` | `~/.scholaraio-hub` | 3400 | `pnpm start` |
| `dev` | `~/.scholaraio-hub-dev` | 3500 | `pnpm dev`、`pnpm hub …` |
| `test` | 临时目录 | 3600 | 单元与浏览器测试 |
| 其他名字 | `~/.scholaraio-hub-<名字>` | 3500 | 显式指定 |

任一命令加 `--production` 或 `--profile <名字>` 切换 profile，也可以设 `SCHOLARAIO_HUB_PROFILE`。`PORT` 和 `SCHOLARAIO_HUB_DATA_DIR` 覆盖默认值。其余配置项见 [.env.example](.env.example)。

数据目录里有：`data/`（文献与索引）、`workspace/`、`sessions/`（会话）、设置、日志、`backups/`（迁移备份）和 `runtime/`（Python 环境及已装能力清单）。CLI 的登录凭据和原生会话记录仍在各 CLI 自己的目录，应用不会扫描它们。

Python 依赖由 `packages/scholaraio/uv.lock` 锁定。更新代码后重新执行对应 profile 的 `pnpm hub setup`；已安装的可选能力（如语义检索）会保留。

## 迁移旧版 ScholarAIO 文献

迁移不会随启动自动执行。先停止旧 ScholarAIO 和 Hub，准备生产环境，生成迁移清单：

```sh
pnpm hub setup --production
pnpm hub migrate --production plan --source /absolute/path/to/old-scholaraio --target /absolute/path/to/.scholaraio-hub
pnpm hub migrate --production apply --manifest /absolute/path/to/manifest.json
# 需要恢复时，先停止 Hub，再执行：
pnpm hub migrate --production rollback --manifest /absolute/path/to/manifest.json
```

清单列出目录、文件数、总大小和目标位置。apply 先备份并校验 SHA-256，再移动用户数据、核对 UUID，最后切换配置并重建关键词索引。遇到冲突或源文件变化会停止，不会覆盖目标中已有的文献。备份保存在目标的 `backups/`。回滚时，如果文件或配置在迁移后被改过，也会停止，以免丢失新的修改。旧代码、虚拟环境、缓存和临时文件不迁移；迁移后请改用 Hub 的启动命令。

## 参与开发

开发环境、测试和提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，架构说明见 [docs/architecture.md](docs/architecture.md)。

## 来源与许可

基于 [YepAnywhere](https://github.com/xueyouxz/yepanywhere) 与 [ScholarAIO](https://github.com/xueyouxz/scholaraio) 二次开发。Python 源码的来源和修改边界见 [packages/scholaraio/README.md](packages/scholaraio/README.md)，原始许可和相关测试一并保留。

[MIT](LICENSE) © 2026 xueyou zhang
