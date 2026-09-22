## Why

文献工作台重构保留了受管理数据和统一消息流，但移除了内部项目归属、原侧栏、卡片阅读入口和完整输入体验。恢复这些操作，让文献项目、阅读和会话重新形成完整流程。

## What Changes

- 恢复内部文献项目列表、项目文献管理与项目下会话分组，不扫描外部 CLI 项目。
- 恢复可调整宽度的侧栏、Library / Skills 导航及底部设置入口。
- 设置支持持久化 Claude Code / Codex 默认工具及模型，新会话使用默认值。
- 恢复文献卡片/列表、详情概览及 PDF/全文阅读，沿用新引用和位置保存。
- 新建和已有会话共享底部 composer，支持输入法、草稿、文献标签、发送、停止和错误恢复。
- 保留独立 CLI 执行目录和应用会话 ID；旧配置编辑可按此前要求保持移除；语音、附件、斜杠命令与项目文件交互按最新要求纳入恢复，依次适配应用会话接口。

## Capabilities

### New Capabilities
- `literature-project-workbench`: 内部项目、文献范围、会话归属与兼容性。
- `restored-literature-interactions`: 侧栏导航、设置、文献卡片与底部输入的恢复要求。

### Modified Capabilities

无；本变更以当前文献工作台为范围，后续归档时需统一过时的第一阶段通用 CLI 规范。

## Impact

影响 shared 数据契约、Python 文献项目 API、Node 会话创建和检索范围、React 工作台及相关测试。新增字段对历史会话向后兼容；复用已有工作区 refs/papers.json，不引入新的依赖或存储系统。
