## 1. Tailwind 4 基础设施

- [x] 1.1 在 `packages/client/package.json` 中添加 `tailwindcss` 和 `@tailwindcss/vite` 依赖
- [x] 1.2 在 `packages/client/vite.config.ts` 中注册 `@tailwindcss/vite` 插件
- [x] 1.3 将 `packages/client/src/styles.css` 替换为 Tailwind 4 入口文件，内容为 `@import "tailwindcss"` 加 reference `@theme` token 导入
- [x] 1.4 将 `reference/styles/reference-theme.css` 的 `@theme` token 块合并到新 `styles.css`，包含颜色、字体、圆角等所有 token
- [x] 1.5 运行 `pnpm dev` 确认 Tailwind 编译通过（此时页面样式预期会崩溃，属正常状态）

## 2. NavigationLayout 与 TopNav

- [x] 2.1 在 `NavigationLayout.tsx` 中创建 `PageTitleContext`，提供 `setTitle(title: string)` 方法并导出 `usePageTitle` hook
- [x] 2.2 在 `NavigationLayout.tsx` 中新增 TopNav 壳（固定顶部细条），读取 `PageTitleContext` 展示页面标题，不含搜索/通知/头像
- [x] 2.3 用 Tailwind 4 utility classes 重写 `NavigationLayout.tsx` 的 JSX + className，移除所有 BEM 类名
- [x] 2.4 在各页面（`SessionPage`、`ProjectsPage`、`SettingsPage` 等）的 `useEffect` 中调用 `setTitle` 注入页面标题

## 3. Sidebar 重写

- [x] 3.1 按 `reference/sections/SidebarReference.tsx` 视觉，用 Tailwind 4 重写 `Sidebar.tsx` 的 JSX + className，移除所有 BEM 类名
- [x] 3.2 在 Sidebar 导航区渲染全量入口：Chat、Library、Search、Reader、Workspaces、Settings；Library / Search / Reader / Workspaces 标记为 disabled（不可点击，视觉灰显）
- [x] 3.3 实现 `PageTitleContext` 中的 `selectedProjectId` 状态（或单独创建 `ProjectScopeContext`），Sidebar 会话列表根据是否有选中 project 决定 fetch 范围
- [x] 3.4 当 `selectedProjectId` 存在时，Sidebar 会话列表调用 `GET /api/projects/:projectId/sessions`；无选中时恢复原有聚合逻辑

## 4. Session 消息气泡样式

- [x] 4.1 按 `reference/components/ChatMessageBubble.tsx` 视觉，用 Tailwind 4 重写 `MessageItem.tsx` 的外层气泡 JSX + className
- [x] 4.2 确保用户消息和 AI 消息气泡均不渲染头像元素
- [x] 4.3 保持 `TextBlock.tsx`、streaming hooks、tool block 等内层渲染逻辑完全不变
- [x] 4.4 按 reference 视觉用 Tailwind 4 重写 `SessionHeader.tsx` 的 JSX + className
- [x] 4.5 按 reference `ChatComposerSection` 视觉用 Tailwind 4 重写 `MessageComposer.tsx` / `MessageInput.tsx` 的 JSX + className

## 5. Settings 页面 — LLM Provider/Project 选择器

- [x] 5.1 在 `SettingsPage.tsx` 中调用 `GET /api/providers`，提取 Claude 组（`claude` / `claude-ollama`）和 Codex 组（`codex` / `codex-oss`）的 `enabled` 状态
- [x] 5.2 实现 Claude / Codex 切换器 UI（按 reference `SettingsModelSection` 视觉），不可用 provider 显示 disabled 样式
- [x] 5.3 切换 provider 后调用 `GET /api/projects`，按 provider 组过滤项目列表并渲染在切换器下方
- [x] 5.4 实现项目选择逻辑：点击项目后更新 `selectedProjectId` 状态，并写入 `localStorage`（key: `selectedProjectId`）
- [x] 5.5 将选中的 provider 写入 `localStorage`（key: `selectedProvider`），App 初始化时读取并校验有效性
- [x] 5.6 加载时若 `localStorage` 中的 `selectedProjectId` 不存在于当前项目列表，则清除该 key
- [x] 5.7 保留 MinerU 路径、Embedding 配置、Settings Footer 的占位 UI（按 reference 视觉用 Tailwind 4 实现，字段先 hardcode）

## 6. 验证

- [x] 6.1 运行 `pnpm typecheck` 确认无 TypeScript 错误
- [x] 6.2 运行 `pnpm lint:fix` 确认 Biome 格式通过
- [ ] 6.3 在浏览器中视觉回归：Sidebar 折叠/展开、全量导航入口（disabled 样式）、TopNav 标题切换
- [ ] 6.4 验证 Chat 页面：消息气泡样式、streaming 正常、无头像
- [ ] 6.5 验证 Settings 页面：provider 切换、项目列表过滤、Sidebar 会话范围联动
- [ ] 6.6 验证 localStorage 持久化：刷新后 provider 和 project 恢复，Sidebar 正确过滤

