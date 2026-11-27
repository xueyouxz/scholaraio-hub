# Docker 本地部署

在仓库根目录运行：

```sh
docker compose up -d --build
```

打开 http://localhost:3400。浏览器通过网页同源的 `/api/library/` 访问文献服务，远程访问只需转发网页端口。3401 保留供直接访问文献 API / MCP。同时允许本机和本机的 Tailscale 地址访问，详见下方说明。

镜像使用 Node.js 22、系统 Python 3 和 uv，按仓库锁文件安装依赖。容器以普通用户运行，启动时同步 Python 环境，保留通过页面安装的可选能力。

## 数据保存

`scholaraio_hub-home` Docker 数据卷挂载在容器的 `/home/node`，其中 `.scholaraio-hub` 保存文献、索引、设置、附件、日志和 Python 环境。容器内 CLI 的配置和会话也保存在该数据卷中。重启、重新构建和 `docker compose down` 均保留数据；`docker compose down -v` 会删除数据。

主机已有的 Claude Code / Codex 登录状态不会自动进入容器。文献导入、阅读和关键词检索可以直接使用；AI 会话需另行在容器中安装和配置所选 CLI。语义检索可在设置中选择本地模型或兼容 OpenAI 的 Embedding API。

## 批量导入已有论文目录

旧库的 `papers/` 文件夹可以直接压缩成 ZIP，到“文献管理 · MCP → 上传已解析文献包”上传。
每篇论文目录需有 `meta.json` 和 `paper.md`，可同时包含 PDF 和 `images/`。
ZIP 内既可保留外层 `papers/`，也可直接放多个论文文件夹；单篇论文的文件直接放在 ZIP 根目录也支持。
**无需手工创建 `manifest.json` 或安装、下载打包工具**，服务端会自动识别目录并生成内部清单。
已有 ID 会保留；没有 ID 时使用原论文目录名。无效元数据或缺少正文会拒绝整包，避免悄悄漏掉论文。

整库导入不再限制每包的论文数、文件数或固定 ZIP 大小，3138 篇论文可以压成一个 ZIP 上传，
无需手工分包。服务端会先检查解压所需磁盘空间，再导入和重建索引；上传与入库期间请保持页面打开。
实际可导入大小取决于服务器的可用磁盘空间；如果前方配置了反向代理，也需允许大文件上传与长时间请求。
导出和单篇解析结果下载的原有限制保留。

如果需要自行控制每个 ZIP 的大小，也可以选择用仓库内的 `scripts/pack-papers.py` 自动分包：

```sh
python3 scripts/pack-papers.py /旧库的绝对路径/data/papers --output /输出的绝对路径/paper-upload
```

自动分包工具需要 Python 3.10 或更新版本，输出目录应为尚不存在的新目录。
打包前暂停旧库写入。当前导入保留元数据、Markdown、支持的图片和 PDF；
`layout.json`、`content_list.json` 等附加 JSON 不在当前导入范围内。

目标库已有论文时不要覆盖其 `index.db`。这些 ZIP 不携带旧数据库或语义向量；
导入会更新目标库的关键词和正文分块索引。相同 ID 或相同 PDF 文件哈希的论文会跳过，
需要语义检索时再在目标库准备向量索引。

## 常用操作

```sh
# 状态和日志
docker compose ps
docker compose logs --tail=100 -f hub

# 停止和再次启动
docker compose down
docker compose up -d

# 环境检查
docker compose exec hub pnpm hub doctor --production

# 拉取上游代码后重新构建
git pull --ff-only
docker compose up -d --build
```

宿主机的 3400、3401 应保持空闲。需要改应用监听端口时，同步修改 compose 中的端口映射和 `PORT` / `LIBRARY_PORT` 环境变量。网页会通过同源路径访问文献服务，不依赖外部的文献服务端口。

## Tailscale 访问

当前机器的 Tailscale IPv4 地址为 `100.64.0.5`。compose 将 3400、3401 同时绑定到本机回环地址和该 Tailscale 地址，并通过 `ALLOWED_HOSTS` 允许此 IP、`macmini`、`macmini.zjutvis.tech` 和自定义域名 `scholaraio.zjutvis.cn`。启动前需确保 Tailscale 已连接。

其他电脑连接到有权访问本机的 Tailscale 网络后：

- 网页：`http://100.64.0.5:3400/library/documents`
- MCP（同源入口）：`http://100.64.0.5:3400/api/library/mcp/`
- MCP（保留的直连入口）：`http://100.64.0.5:3401/mcp/`

当前 HTTPS 域名通过反向代理提供网页 `https://scholaraio.zjutvis.cn` 和 MCP `https://scholaraio.zjutvis.cn/api/library/mcp/`。文献服务设置、上传、下载和事件流均通过同一个域名转发，无需单独为 3401 配置 HTTPS。反向代理应保留 `/api/library/` 路径、允许所需的上传大小和超时，并关闭 SSE 缓冲。

远端 Codex 配置：

```toml
[mcp_servers.scholaraio]
url = "https://scholaraio.zjutvis.cn/api/library/mcp/"
```

通过 Tailscale IP 使用网页和同源 MCP 时，只需允许 3400；只有直连文献服务时才需要 3401。使用 IP 不依赖 DNS 配置；已正确配置 DNS 时也可以使用上述机器名称。当前没有应用登录，获准连接的设备共享文献管理权限，MCP 工具仍为只读。

迁移机器或更换地址时，可在仓库根目录的 `.env` 中设置 `SCHOLARAIO_TAILSCALE_IP` 和 `SCHOLARAIO_TAILSCALE_HOSTS`（额外允许的主机名称，以逗号分隔），再运行 `docker compose up -d`。MinerU 继续由应用容器内部调用，无需向其他电脑开放解析服务。

## 本机网络配置

本机 Docker 的默认地址池已用满，因此 compose 为本项目显式指定 `10.254.240.48/28`。该网段已检查未被现有容器或本机路由使用。迁移到其他机器时，如有冲突，可通过 `SCHOLARAIO_DOCKER_SUBNET` 指定另一个空闲网段。

本机首次构建使用已有的 HTTP 代理下载依赖。如果重新构建时遇到网络连接问题，可以运行：

```sh
docker compose build \
  --build-arg HTTP_PROXY=http://host.docker.internal:1081 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:1081
docker compose up -d
```

代理参数仅用于构建，不写入应用运行时配置。

## 本地 MinerU、文献管理与 MCP

本次功能位于 `feature/mineru-shared-library-auth` 分支。登录注册和新增 Chat 暂缓，文献库共享，MCP 只提供读取能力。

配置保存在服务器数据卷中，所有设备读取和修改同一份配置。MinerU 地址由服务端调用，应填写容器能访问的解析服务地址，不是访问网页的电脑的本地地址。

1. 打开“设置 → 文献服务”，填写本地 MinerU 地址。当前机器上的服务在宿主机 `18000` 端口；应用运行在 Docker 中，应填写 `http://host.docker.internal:18000`。本地解析无需云端 token。
2. MinerU 4.x 选择 `basic`（OCR 解析）或 `flash`（快速文字提取）；旧版 `/file_parse` 服务选择 `pipeline`。保存后点击检查，再从“导入文献”上传 PDF。
3. 打开“文献库 → 文献管理 · MCP”，勾选所需论文，下载原 PDF、Markdown / 图片或可迁移的文献包。也可以上传已有文献包或单篇 MinerU 结果 ZIP（一个 Markdown 文件及其图片）。没有原 PDF 的导入结果不能提供原 PDF 下载。
4. 类别优先使用手动设置；否则根据元数据或解析文本开头明确的会议名称识别。支持常见会议，例如 CVPR、ICCV、ECCV、NeurIPS、ICML、ICLR、ACL、EMNLP 等；无法确定则显示“待分类”。可以批量分配类别或恢复自动分类。

文献包 ZIP 包含选定论文的公开元数据、PDF、Markdown、图片，以及已有的论文向量（JSON 数组），不包含应用设置、API 密钥、对话或阅读进度。导入时校验路径、数量、大小、向量模型和维度；按论文 ID 或原 PDF 内容识别到的重复文献会跳过。向量模型不匹配时需先对齐设置，或者导入原始 MinerU ZIP 后重新建立索引。现有任意第三方向量数据库文件不能直接导入。

关键词检索和读取全文无需额外模型。语义检索可在“设置 → 语义检索 → 向量生成方式”中选择：

- **本地模型**：安装可选运行环境、下载嵌入模型，再准备索引。
- **API（兼容 OpenAI）**：填写独立的 Embedding 模型名称、API 基础地址（如服务商提供的 `/v1` 路径）和 API Key，系统向该地址追加 `/embeddings`。无需安装本地模型运行环境。保存配置不会调用 API；点击“自检”会发起一次简短请求。通过后点击“准备语义检索”，为文献生成向量。

API 模式会向所配置的服务发送论文标题、摘要和搜索文本，调用按服务商规则计费；请使用嵌入模型而非聊天模型。配置保存在服务器，密钥只写入并以掩码显示。切换生成方式、模型或 API 地址后，旧索引会提示未就绪，需要重新准备语义检索，正文和 PDF 保留。API 模式使用本地 SQLite 中的向量做精确余弦检索，无需下载 PyTorch 或 FAISS；大规模文献库的查询耗时随向量数量增长。

文献包没有向量时只导入文档。当前向量索引沿用项目原有的论文标题 / 摘要嵌入，全文片段检索另由关键词和阅读摘录提供。

### 本地 Codex 接入

把下面配置加入用户本机的 `~/.codex/config.toml`，然后重新加载 Codex 的 MCP 配置或重启 Codex：

```toml
[mcp_servers.scholaraio]
url = "http://127.0.0.1:3400/api/library/mcp/"
```

也可以在本机终端运行：

```sh
codex mcp add scholaraio --url http://127.0.0.1:3400/api/library/mcp/
```

可用工具：

| 工具 | 用途 |
| --- | --- |
| `list_papers` | 按类别分页列出论文、ID、解析状态 |
| `list_collections` | 列出论文集合 |
| `search_papers` | 关键词、作者或语义检索，可限制 `paper_ids` / `collection_ids` |
| `read_paper` | 分页读取解析后的 Markdown，返回引用行号和下一页位置 |
| `retrieve_passages` | 返回问题相关的片段及论文 ID、行号，支持限定论文范围 |

例如向 Codex 说：“使用 scholaraio 列出 NeurIPS 论文，再只检索其中这两篇论文，比较方法并引用论文 ID 和原文行号。”省略 `paper_ids` 表示整个共享库；明确传入空数组表示不检索任何论文（提供集合时取指定集合）。工具不会保存对话，对话由用户自己的 Codex 管理。

MCP 接口无需网页登录或应用 API 密钥；仅提供只读工具，不提供上传、删除、配置或会话接口。当前 Docker 端口监听本机回环地址及本机 Tailscale 地址，接口校验 Host 并拒绝带浏览器 Origin 的 MCP 请求。其他电脑上的 `127.0.0.1` 指向其自身；通过 Tailscale 接入时应使用上文的 `100.64.0.5` 地址。
