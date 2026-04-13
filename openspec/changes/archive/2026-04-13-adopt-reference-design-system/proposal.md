## Why

`packages/client` 的视觉风格和设计语言与 `reference/` 目录中沉淀的设计系统存在明显断层：当前客户端使用手写 BEM CSS，而 reference 已定义了完整的 Tailwind 4 `@theme` token 系统、布局规范和组件视觉规范。需要将前者迁移到后者，使产品视觉一致、可维护，并为后续功能页面（Library、Reader、Search）奠定设计基础。

## What Changes

- 将 `packages/client` 的 CSS 框架从手写 BEM CSS 迁移到 **Tailwind 4**，采用 `reference/styles/reference-theme.css` 的 `@theme` token 系统替换现有 `styles.css`。
- 按照 reference 的 `SidebarReference` 设计重写 `Sidebar.tsx`：全量渲染导航入口（含未实现页面，标记 disabled）；按当前选中 Project 过滤会话列表。
- 在 `NavigationLayout.tsx` 中引入 TopNav 壳，仅包含页面标题，标题内容由子页面通过 Context 注入。
- 按照 reference 的 `ChatMessageBubble` 重写 `MessageItem.tsx` 外层气泡样式（无头像，保留 streaming + TextBlock 逻辑不变）。
- 重设计 Settings 页面的 LLM 配置区域：新增 Claude / Codex 切换器（调用 `GET /api/providers` 检测状态，不可用时显示 disabled）；切换后列出对应 provider 的项目（`GET /api/projects` 按 `provider` 字段过滤）；选中状态持久化到 `localStorage`；其余设置区域（MinerU 路径、Embedding 配置）保留占位 UI。
- 选中 Project 后，Sidebar 会话列表只展示该 Project 的会话。

## Capabilities

### New Capabilities

- `client-design-system`: 在 `packages/client` 中建立基于 Tailwind 4 的设计系统，包含 `@theme` token、字体、颜色和圆角规范，替代现有手写 CSS。
- `client-provider-project-selector`: Settings 页面中的 Provider（Claude/Codex）切换器与 Project 选择器，驱动 Sidebar 的会话过滤范围。

### Modified Capabilities

- `client-workbench-shell`: 更新 shell 规范，要求 Sidebar 全量渲染导航入口（未实现页面 disabled），TopNav 仅含标题，均使用 Tailwind 4 实现。
- `client-session-workflow`: 更新会话页面规范，要求消息气泡采用 reference 视觉风格（无头像），Composer 和 SessionHeader 使用 Tailwind 4 实现。

## Impact

- `packages/client/src/styles.css`：完全替换为 Tailwind 4 入口文件。
- `packages/client/package.json` / `vite.config.ts`：新增 `@tailwindcss/vite` 插件依赖。
- `packages/client/src/app/components/NavigationLayout.tsx`：引入 TopNav 壳与页面标题 Context。
- `packages/client/src/app/components/Sidebar.tsx`：重写视觉，加入 provider 过滤逻辑。
- `packages/client/src/app/session/components/MessageItem.tsx`：重写外层气泡样式。
- `packages/client/src/app/pages/SettingsPage.tsx`：新增 Claude/Codex 切换器与 Project 选择器。
- 不涉及后端 API 变更；不影响 streaming、SSE、session 数据流。
