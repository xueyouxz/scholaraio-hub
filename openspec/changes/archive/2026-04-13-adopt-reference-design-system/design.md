## Context

`packages/client` 是一个 Vite + React 19 + React Router 7 的前端应用，当前使用单文件手写 BEM CSS（`styles.css`）和 CSS 变量作为样式系统。`reference/` 目录中已沉淀了完整的 Tailwind 4 设计系统，包含 `@theme` token、约 50 个纯展示组件和 7 个页面设计稿。本次迁移目标是：以 reference 为视觉标准，在现有组件文件上原地重写 JSX 和 className，同时保留所有业务逻辑、streaming 管线和 API 集成不变。

## Goals / Non-Goals

**Goals:**
- 将 `packages/client` 的 CSS 框架切换到 Tailwind 4，采用 reference 的 `@theme` token 系统
- 按 reference 视觉重写 Sidebar、NavigationLayout（TopNav）、MessageItem、SettingsPage 的 JSX + className
- 在 Settings 页面新增 Claude/Codex provider 切换器与 project 选择器，驱动 Sidebar 会话过滤
- Sidebar 渲染全量导航入口，未实现页面标记 disabled

**Non-Goals:**
- 不实现 Library、Search、Reader、Workspaces 功能页面
- 不修改 streaming 逻辑、TextBlock.tsx、API client、路由结构
- 不引入状态管理库（Redux、Zustand 等）
- 不做移动端响应式适配（维持现有折叠行为即可）
- 不改动后端任何接口

## Decisions

### D1：Tailwind 4 via @tailwindcss/vite，直接替换 styles.css

**决策**：在 `packages/client/package.json` 中添加 `tailwindcss` 和 `@tailwindcss/vite` 依赖，在 `vite.config.ts` 中注册插件，将 `styles.css` 替换为只包含 `@import "tailwindcss"` 和 reference theme token 的入口文件。

**备选**：保留旧 `styles.css` 作为过渡兼容层 → 否决，BEM 类名与 Tailwind utility 混用会导致调试困难，且迁移完成后旧 CSS 无人维护。

**理由**：clean-cut 替换比渐进迁移总工作量更小，因为组件数量少（~15 个），一次性可以全量完成。

### D2：方案 B — 在现有组件文件上原地重写 JSX + className

**决策**：不 copy reference 组件文件，而是以 reference 为视觉参考，直接修改现有组件的 JSX 结构和 className。业务逻辑（state、hooks、handlers）原地保留。

**备选**：
- 方案 A（copy reference 组件 + 注入 props）→ reference 的 props 接口基于 mock 数据设计，与真实业务类型不匹配，需要额外适配层
- 方案 C（Container/Presentational 分层）→ 引入额外文件和间接层，当前规模不值得

**理由**：现有组件数量少，改动范围清晰，原地修改是最直接的路径。

### D3：TopNav 标题通过 React Context 从子页面注入

**决策**：在 `NavigationLayout.tsx` 中创建 `PageTitleContext`，提供 `setTitle(title: string)` 方法。各页面在 `useEffect` 中调用 `setTitle`。TopNav 读取 context 值展示标题。

**备选**：每个页面自己渲染顶部区域 → 导致重复代码，TopNav 样式难以统一

**理由**：Context 注入是 React 中处理"子页面控制父壳层内容"的标准模式，实现简单，无需引入新依赖。

### D4：Provider + Project 选中状态存 localStorage

**决策**：`selectedProvider`（`"claude"` | `"codex"`）和 `selectedProjectId`（string）存入 `localStorage`。App 初始化时读取并校验（项目是否仍存在），无效则清除。

**备选**：存后端 `ServerSettings.newSessionDefaults` → `newSessionDefaults` 中无 `projectId` 字段，需要改 schema；且这是 UI 偏好而非服务端配置

**理由**：localStorage 是纯前端偏好的标准存储位置，零后端改动，刷新后状态保留。

### D5：Provider 分组策略

**决策**：UI 层只显示 Claude 和 Codex 两个入口。后端 provider 映射关系：`claude` + `claude-ollama` → Claude 组；`codex` + `codex-oss` → Codex 组。任一组内有 `enabled: true` 的 provider，该入口即为可用。Project 过滤时同样按组匹配（Claude 组过滤 `provider === "claude" || provider === "claude-ollama"`）。

**理由**：与用户对齐的决策（Q10），简化 UI 认知负担，同时不丢失历史 session 的可见性。

## Risks / Trade-offs

- **Tailwind purge 误删类名** → 迁移期间确保所有动态类名用完整字符串而非字符串拼接，避免 Tailwind JIT 扫描不到
- **reference token 命名与旧 CSS 变量不完全对应** → 需要逐组件对照映射，可能有遗漏；建议迁移后视觉回归测试
- **localStorage 状态可能过期**（项目被删除）→ 已在 spec 中要求加载时校验，无效则清除
- **Settings 页面双重职责**（配置 + 选择器）→ 短期可接受，后续可将 Provider/Project 选择器提升为全局 header 控件

## Migration Plan

1. 安装 Tailwind 4 依赖，更新 `vite.config.ts`，替换 `styles.css` — 此步骤完成后全站样式会短暂崩溃，属预期行为
2. 按组件逐一重写 JSX + className（顺序建议：NavigationLayout → Sidebar → SessionHeader → MessageItem → MessageComposer → SettingsPage）
3. 新增 `PageTitleContext` 并接入各页面
4. 实现 Provider/Project 选择器及 localStorage 持久化
5. 验证：`pnpm dev` 视觉回归 + `pnpm typecheck` + `pnpm lint:fix`

## Open Questions

- Settings 页面现有的 `globalInstructions` 字段 UI 是否需要保留？（当前 stub 页面未实现，本次可做占位）
- MinerU 路径和 Embedding 配置的 API 端点是否已存在于后端？（本次只做占位 UI，无需接 API，但需确认字段名以便后续）
