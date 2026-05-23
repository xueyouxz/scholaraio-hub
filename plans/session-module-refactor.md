# 执行计划：会话模块架构优化与重构

## 背景

本计划基于会话模块（`packages/client/src/features/session`）的系统性架构分析，针对以下七类问题制定分阶段优化路径：

| # | 问题 | 严重性 |
|---|------|--------|
| 1 | `thinkingExpanded` 全局状态导致交互缺陷 | 高（正确性） |
| 2 | `scrollTrigger` 命令伪装为声明式状态 | 高（语义错误） |
| 3 | `AgentContentContext` inflight 竞争 + polling | 高（并发正确性） |
| 4 | `preprocessMessages` 内嵌工具特定逻辑 | 中（可维护性） |
| 5 | `AgentContent` 状态归属错误 | 中（设计） |
| 6 | `loadingAgents` Set 每次重建 | 低（性能） |
| 7 | `ToolCallRow` 双层 `useMemo` 级联失效 | 低（性能） |

**原则：每个阶段独立可回滚，测试通过后提交，再进入下一阶段。**

---

## Phase 0 — 安全基线：提交并推送当前代码

> 在任何重构开始前，确保当前工作树的状态被保存到远程，以便任意阶段失败时可以回退。

### 任务

1. 检查当前工作树状态 (`git status`)
2. 将所有已修改文件暂存并提交：
   ```bash
   git add -A
   git commit -m "Checkpoint before session module refactor"
   ```
3. 推送到远程：
   ```bash
   git push origin main
   ```
4. 确认远程分支与本地一致后，为本次重构创建工作分支（可选，按团队流程）：
   ```bash
   git checkout -b refactor/session-module-architecture
   ```

### 验收

- `git status` 输出 clean working tree
- `git log --oneline -3` 可见 checkpoint commit
- 远程分支已更新

---

## Phase 1 — `ThinkingBlock` 状态局部化

**目标**：删除 `MessageList` 中的全局 `thinkingExpanded` 状态，将展开状态下沉为 `ThinkingBlock` 的私有 `useState`，修复所有 ThinkingBlock 同步展开/折叠的交互缺陷。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `features/session/components/blocks/ThinkingBlock.tsx` | 新增内部 useState，删除 props |
| `features/session/components/RenderItemComponent.tsx` | 删除 thinkingExpanded / toggleThinkingExpanded props |
| `features/session/components/MessageList.tsx` | 删除 useState + toggleThinkingExpanded + 相关 useCallback |

### 实施步骤

**Step 1.1** — 修改 `ThinkingBlock.tsx`

将 `isExpanded` / `onToggle` 两个 prop 替换为内部 state：

```tsx
// Before
interface Props {
  thinking: string;
  status: "streaming" | "complete";
  isExpanded: boolean;
  onToggle: () => void;
}

// After
interface Props {
  thinking: string;
  status: "streaming" | "complete";
  /** 初始展开状态，默认 false */
  defaultExpanded?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({ thinking, status, defaultExpanded = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  // ...
});
```

**Step 1.2** — 修改 `RenderItemComponent.tsx`

- 删除 `thinkingExpanded: boolean` prop
- 删除 `toggleThinkingExpanded: () => void` prop
- 更新 `handleClick` 的 useCallback deps（移除这两个依赖）
- 更新 `ThinkingBlock` 调用：删除 `isExpanded` / `onToggle` 传参

**Step 1.3** — 修改 `MessageList.tsx`

- 删除 `const [thinkingExpanded, setThinkingExpanded] = useState(false)`
- 删除 `const toggleThinkingExpanded = useCallback(...)`
- 删除所有传入 `RenderItemComponent` 的 `thinkingExpanded` / `toggleThinkingExpanded` props

### TDD 测试要求

**新增测试文件**：`features/session/components/blocks/__tests__/ThinkingBlock.test.tsx`

```typescript
describe('ThinkingBlock', () => {
  it('默认折叠状态', () => {
    // render ThinkingBlock，验证 details 元素 open 属性为 false
  });

  it('点击展开后状态独立', () => {
    // render 两个 ThinkingBlock，点击第一个，验证第二个不受影响
  });

  it('streaming 状态下显示 "Thinking..."', () => {
    // render status="streaming"，验证 summary 文字
  });

  it('complete 状态下显示 "Thinking"', () => {
    // render status="complete"，验证 summary 文字
  });

  it('defaultExpanded=true 时初始展开', () => {
    // render defaultExpanded={true}，验证 open 为 true
  });
});

describe('RenderItemComponent with ThinkingItem', () => {
  it('不再接受 thinkingExpanded prop', () => {
    // 验证类型：Props 不包含 thinkingExpanded
  });
  it('多个 thinking item 各自独立展开', () => {
    // render 两个 ThinkingItem，验证独立性
  });
});
```

### 验收标准

```bash
pnpm typecheck          # 零类型错误
pnpm test               # 新增测试全部通过
pnpm lint               # Biome 检查通过
```

**手动验证**：打开包含多个 thinking block 的会话，展开其中一个，其余不受影响。

### 提交

```bash
git add packages/client/src/features/session/components/blocks/ThinkingBlock.tsx \
        packages/client/src/features/session/components/RenderItemComponent.tsx \
        packages/client/src/features/session/components/MessageList.tsx \
        packages/client/src/features/session/components/blocks/__tests__/ThinkingBlock.test.tsx
git commit -m "Scope ThinkingBlock expand state to local useState"
```

---

## Phase 2 — `scrollTrigger` 计数器 → `useImperativeHandle`

**目标**：消除"命令通过声明式状态传递"的反模式，`MessageList` 通过 `forwardRef + useImperativeHandle` 暴露 `scrollToBottom()` 命令。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `features/session/components/MessageList.tsx` | 改为 forwardRef，添加 useImperativeHandle |
| `app/pages/SessionPage.tsx` | 创建 ref，删除 scrollTrigger state，在 send/queue 中直接调用 |

### 实施步骤

**Step 2.1** — 修改 `MessageList.tsx`

```tsx
export interface MessageListHandle {
  scrollToBottom: () => void;
}

export const MessageList = memo(forwardRef<MessageListHandle, Props>(function MessageList(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 保留原有 scrollToBottom 逻辑...

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      const container = containerRef.current?.parentElement;
      if (container) {
        shouldAutoScrollRef.current = true;
        scrollToBottom(container);
      }
    },
  }), [scrollToBottom]);

  // Props 删除：scrollTrigger
}));
```

**Step 2.2** — 修改 `SessionPage.tsx`

```tsx
const messageListRef = useRef<MessageListHandle>(null);
// 删除：const [scrollTrigger, setScrollTrigger] = useState(0);

// 在 send() 成功路径
messageListRef.current?.scrollToBottom();
// 删除：setScrollTrigger((n) => n + 1);

// 传入 ref
<MessageList ref={messageListRef} ... />
// 删除：scrollTrigger={scrollTrigger}
```

### TDD 测试要求

**新增/更新测试**：`features/session/components/__tests__/MessageList.test.tsx`

```typescript
describe('MessageList imperative handle', () => {
  it('通过 ref 暴露 scrollToBottom 方法', () => {
    const ref = createRef<MessageListHandle>();
    render(<MessageList ref={ref} messages={[]} ... />);
    expect(ref.current?.scrollToBottom).toBeTypeOf('function');
  });

  it('scrollToBottom 调用后容器滚动到底部', () => {
    // 使用 jsdom 验证 scrollTop 行为（或 spy scrollToBottom）
  });

  it('不再接受 scrollTrigger prop', () => {
    // 类型层面验证：Props 不包含 scrollTrigger
  });
});
```

### 验收标准

```bash
pnpm typecheck && pnpm test && pnpm lint
```

**手动验证**：发送消息后页面自动滚动到底部；长会话中用户向上滚动后发送消息，页面跳回底部。

### 提交

```bash
git add packages/client/src/features/session/components/MessageList.tsx \
        packages/client/src/app/pages/SessionPage.tsx \
        packages/client/src/features/session/components/__tests__/MessageList.test.tsx
git commit -m "Replace scrollTrigger counter with MessageList imperative handle"
```

---

## Phase 3 — `AgentContentContext` Inflight 去重

**目标**：用 `Map<string, Promise>` 替换 `setInterval` polling 模式，消除并发加载竞争条件，稳定 `loadAgentContent` 的函数引用。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `features/session/contexts/AgentContentContext.tsx` | 重构 loadAgentContent 实现，修复 useAgentContentOptional |

### 实施步骤

**Step 3.1** — 重构 `AgentContentContext.tsx`

```tsx
export function AgentContentProvider({ ... }) {
  // 替换：useState<Set<string>> → useRef<Map<string, Promise<AgentContent>>>
  const inflightRef = useRef<Map<string, Promise<AgentContent>>>(new Map());
  const loadedRef = useRef<Set<string>>(new Set());
  // 保留用于触发 isLoading re-render 的版本号（Phase 6 可进一步优化）
  const [loadingVersion, setLoadingVersion] = useState(0);

  const loadAgentContent = useCallback(
    async (loadProjectId: string, loadSessionId: string, agentId: string): Promise<AgentContent> => {
      // 已加载：直接返回
      if (loadedRef.current.has(agentId)) {
        // 从 setAgentContent 更新函数中读取当前值，避免 stale closure
        return new Promise<AgentContent>((resolve) => {
          setAgentContent((prev) => {
            resolve(prev[agentId] ?? { messages: [], status: 'pending' });
            return prev;
          });
        });
      }

      // 飞行中：复用同一 Promise
      const inflight = inflightRef.current.get(agentId);
      if (inflight) return inflight;

      // 开始加载
      setLoadingVersion(v => v + 1);
      const promise = (async () => {
        try {
          const data = await api.getAgentSession(loadProjectId, loadSessionId, agentId);
          loadedRef.current.add(agentId);
          setAgentContent((prev) => mergeAgentContent(prev, agentId, data));
          return data as AgentContent;
        } finally {
          inflightRef.current.delete(agentId);
          setLoadingVersion(v => v + 1);
        }
      })();

      inflightRef.current.set(agentId, promise);
      return promise;
    },
    // 移除 agentContent 和 loadingAgents 依赖
    [setAgentContent],
  );

  const isLoading = useCallback(
    (agentId: string) => inflightRef.current.has(agentId),
    [loadingVersion], // 仅响应版本号变化
  );
}
```

**Step 3.2** — 修复 `useAgentContentOptional` 的 `load()` 实现

```tsx
export function useAgentContentOptional(agentId: string | undefined, sessionId?: string, projectId?: string) {
  const context = useContext(AgentContentContext);
  if (!context || !agentId) return null;

  return {
    content: context.agentContent[agentId],
    isLoading: context.isLoading(agentId),
    load: async () => {
      if (!projectId || !sessionId) return;
      await context.loadAgentContent(projectId, sessionId, agentId);
    },
  };
}
```

### TDD 测试要求

**新增测试文件**：`features/session/contexts/__tests__/AgentContentContext.test.tsx`

```typescript
describe('AgentContentContext - inflight deduplication', () => {
  it('并发两次加载同一 agentId 只发起一次 fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ messages: [], status: 'completed' });
    // setup provider with mocked api
    const [result1, result2] = await Promise.all([
      loadAgentContent('p', 's', 'agent1'),
      loadAgentContent('p', 's', 'agent1'),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  it('已加载的 agent 不再发起 fetch', async () => {
    await loadAgentContent('p', 's', 'agent1');
    await loadAgentContent('p', 's', 'agent1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fetch 失败后可重试', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network'));
    await expect(loadAgentContent('p', 's', 'agent1')).rejects.toThrow();
    // 确认 inflight 已清除，可重试
    fetchSpy.mockResolvedValue({ messages: [], status: 'completed' });
    await expect(loadAgentContent('p', 's', 'agent1')).resolves.toBeDefined();
  });

  it('isLoading 在 fetch 期间返回 true，完成后返回 false', async () => {
    // 验证加载状态变化
  });
});
```

### 验收标准

```bash
pnpm typecheck && pnpm test && pnpm lint
```

### 提交

```bash
git add packages/client/src/features/session/contexts/AgentContentContext.tsx \
        packages/client/src/features/session/contexts/__tests__/AgentContentContext.test.tsx
git commit -m "Fix AgentContentContext inflight deduplication and stale closure"
```

---

## Phase 4 — `preprocessMessages` 工具特定逻辑外移

**目标**：将 `enrichWriteStdinWithCommand` 移入 `WriteStdinRenderer`，将 `parseAgentResultFromText` 移入 `TaskRenderer`，使通用预处理层专注于核心 Message → RenderItem 转换。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `lib/preprocessMessages.ts` | 删除 enrichWriteStdinWithCommand、parseAgentResultFromText 及相关工具函数 |
| `renderers/tools/WriteStdinRenderer.tsx` | 新增 enrichment 逻辑（内联或 import 拆分函数） |
| `renderers/tools/TaskRenderer.tsx` | 新增 parseAgentResultFromText（从 preprocessMessages 移入） |

### 实施步骤

**Step 4.1** — 分析 `enrichWriteStdinWithCommand` 的调用位置

`enrichWriteStdinWithCommand` 当前在 `preprocessMessages` 的末尾作为 post-processing pass 运行，它需要访问 **整个** items 数组以关联 Bash/Read/Write 工具调用的 sessionId。

这意味着直接移入 `WriteStdinRenderer` 时需要改变数据传递方式：options 是接受所有 items 还是在 renderer 内部重新查找？

**推荐方案**：提取为独立的纯函数模块 `lib/enrichWriteStdin.ts`，从 `preprocessMessages.ts` 中删除，在 `WriteStdinRenderer` 中 import 并在渲染时应用（仅对 WriteStdin 类型 item 触发）。

```typescript
// lib/enrichWriteStdin.ts — 移出后的独立模块
export function resolveWriteStdinContext(
  item: ToolCallItem,
  allItems: RenderItem[],
): ToolCallItem { ... }
```

**Step 4.2** — 移动 `parseAgentResultFromText`

直接将函数从 `preprocessMessages.ts` 剪切到 `renderers/tools/TaskRenderer.tsx`（或新建 `lib/parseAgentResult.ts`）。在 `attachToolResult` 内的调用处改为 import。

**Step 4.3** — 清理 `preprocessMessages.ts`

删除移出的函数和相关辅助（`isCommandSessionToolName`、`isFileSessionToolName`、`extractFilePathFromToolInput`、`withLinkedCommand`、`withLinkedFilePath`、`withLinkedToolName`、`extractSessionIdFromWriteStdinInput`、`coerceSessionId`、`extractSessionIdFromToolResult`）。

### TDD 测试要求

**更新/新增测试**：

```typescript
// lib/__tests__/preprocessMessages.test.ts
describe('preprocessMessages', () => {
  it('不再调用 enrichWriteStdinWithCommand', () => {
    // 验证输出 items 不含 linked_command 字段（enrichment 应在 renderer 层做）
  });

  it('核心转换：user message → UserPromptItem', () => { ... });
  it('tool_use + tool_result 配对', () => { ... });
  it('orphaned tool 标记为 aborted', () => { ... });
  it('session_setup 消息折叠', () => { ... });
});

// renderers/tools/__tests__/WriteStdinRenderer.test.tsx
describe('WriteStdinRenderer', () => {
  it('显示关联的 Bash 命令（enrichment）', () => { ... });
  it('无关联命令时正常渲染', () => { ... });
});

// renderers/tools/__tests__/TaskRenderer.test.tsx
describe('TaskRenderer - parseAgentResultFromText', () => {
  it('解析 agentId 行', () => { ... });
  it('解析 <usage> 块', () => { ... });
  it('无 agentId 时返回 undefined', () => { ... });
});
```

### 验收标准

```bash
pnpm typecheck && pnpm test && pnpm lint
```

**确认**：`preprocessMessages.ts` 行数从 677 降至约 350 以内。

### 提交

```bash
git add packages/client/src/features/session/lib/ \
        packages/client/src/features/session/components/renderers/tools/WriteStdinRenderer.tsx \
        packages/client/src/features/session/components/renderers/tools/TaskRenderer.tsx
git commit -m "Extract tool-specific enrichment out of preprocessMessages"
```

---

## Phase 5 — `AgentContent` 状态归属迁移

**目标**：将 `agentContent`/`setAgentContent`/`toolUseToAgent` 的状态所有权从 `useSession` 迁移到 `AgentContentContext`，消除这三个值从 useSession → SessionPage → AgentContentProvider 的 prop 传递链。

> ⚠️ **风险最高的阶段**：需要修改 `useSession`（1125 行）和 `AgentContentContext` 的状态边界。建议在 Phase 3 完成后再进行。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `contexts/AgentContentContext.tsx` | 新增 state 持有（agentContent, toolUseToAgent）+ pushAgentContent 接口 |
| `hooks/useSession.ts` | 删除 agentContent/setAgentContent/toolUseToAgent，改为 useAgentContent() |
| `app/pages/SessionPage.tsx` | 删除 3 个 props 传递 |

### 实施步骤

**Step 5.1** — `AgentContentContext` 新增状态持有

```tsx
interface AgentContentContextValue {
  agentContent: AgentContentMap;
  toolUseToAgent: Map<string, string>;
  loadAgentContent: (...) => Promise<AgentContent>;
  isLoading: (agentId: string) => boolean;
  projectId: string;
  // 新增：供 useSession 推送 SSE 内容
  pushAgentMessage: (agentId: string, message: Message) => void;
  pushToolUseMapping: (toolUseId: string, agentId: string) => void;
}
```

AgentContentContext 内部持有 `agentContent` 和 `toolUseToAgent` 的 useState。

**Step 5.2** — `useSession` 内部使用 context

在 SSE 事件处理函数中，替换 `setAgentContent(...)` 为 `pushAgentMessage(agentId, message)`，替换 `setToolUseToAgent(...)` 为 `pushToolUseMapping(...)`.

**Step 5.3** — 验证 `SessionPage` 中的 props 清理

AgentContentProvider 不再需要 `agentContent`/`setAgentContent`/`toolUseToAgent` props。

### TDD 测试要求

```typescript
describe('AgentContentContext - state ownership', () => {
  it('pushAgentMessage 更新 agentContent', () => {
    // 验证 context 内部状态更新
  });

  it('pushToolUseMapping 建立 tool_use_id → agentId 映射', () => { ... });

  it('useSession 不再返回 agentContent/setAgentContent/toolUseToAgent', () => {
    // 类型测试：验证 useSession 返回类型不含这 3 个字段
  });
});
```

### 验收标准

```bash
pnpm typecheck && pnpm test && pnpm lint
pnpm test:e2e  # 端到端验证 Task 工具展开仍然正常工作
```

### 提交

```bash
git add packages/client/src/features/session/contexts/AgentContentContext.tsx \
        packages/client/src/features/session/hooks/useSession.ts \
        packages/client/src/app/pages/SessionPage.tsx
git commit -m "Move AgentContent state ownership into AgentContentContext"
```

---

## Phase 6 — `loadingAgents` Set 稳定化 + 杂项性能修复

**目标**：修复 `loadingAgents` Set 每次重建导致的 isLoading 引用不稳定问题；合并 `ToolCallRow` 的双层 `useMemo`；统一 `window.__STREAMING_DEBUG__` 类型声明。

**受影响文件**

| 文件 | 变更类型 |
|------|---------|
| `contexts/AgentContentContext.tsx` | 改为 ref + version 模式（如 Phase 5 未覆盖） |
| `components/blocks/ToolCallRow.tsx` | 合并双层 useMemo |
| `src/global.d.ts`（新建） | 集中 window.__STREAMING_DEBUG__ 类型声明 |
| `lib/preprocessMessages.ts` | 删除 window type cast |
| `contexts/StreamingMarkdownContext.tsx` | 删除 window type cast |

### 实施步骤

**Step 6.1** — `ToolCallRow` useMemo 合并

```tsx
// Before: 两个 useMemo，renderContext 是中间变量
const renderContext = useMemo(() => ({ isStreaming: status === "pending", theme: "dark", toolUseId: id, provider: sessionProvider }), [status, id, sessionProvider]);
const interactiveSummaryContent = useMemo(() => ...(renderContext), [..., renderContext]);

// After: 单层，内联 context 构造
const interactiveSummaryContent = useMemo(() => {
  if (status !== "complete") return null;
  const ctx: RenderContext = { isStreaming: false, theme: "dark", toolUseId: id, provider: sessionProvider };
  return toolRegistry.renderInteractiveSummary(toolName, toolInput, structuredResult, toolResult?.isError ?? false, ctx);
}, [status, toolName, toolInput, structuredResult, toolResult, id, sessionProvider]);
```

**Step 6.2** — `global.d.ts` 统一类型声明

```typescript
// packages/client/src/global.d.ts
interface Window {
  __STREAMING_DEBUG__?: boolean;
}
```

删除 `preprocessMessages.ts` 和 `StreamingMarkdownContext.tsx` 中的 `window as unknown as { __STREAMING_DEBUG__?: boolean }` cast。

### TDD 测试要求

```typescript
describe('ToolCallRow memoization', () => {
  it('status 不变时 interactiveSummaryContent 不重算', () => {
    // 使用 vi.spyOn(toolRegistry, 'renderInteractiveSummary')
    // 验证 re-render 时未被调用
  });
});
```

### 验收标准

```bash
pnpm typecheck && pnpm test && pnpm lint
```

### 提交

```bash
git add packages/client/src/features/session/components/blocks/ToolCallRow.tsx \
        packages/client/src/global.d.ts \
        packages/client/src/features/session/lib/preprocessMessages.ts \
        packages/client/src/features/session/contexts/StreamingMarkdownContext.tsx
git commit -m "Stabilize loadingAgents Set, merge ToolCallRow useMemo, centralize debug type"
```

---

## Phase 7 — 全面验证与收尾

**目标**：确保所有阶段的修改在完整构建和端到端测试中通过，补全类型覆盖，清理遗留的 `SessionMetadataContext` 重复路径。

### 任务清单

- [ ] 删除 `features/session/contexts/SessionMetadataContext.tsx`（仅 re-export），将引用该文件的 import 更新为 `shared/contexts/SessionMetadataContext`
- [ ] 完整运行 `pnpm build`，确认构建无误
- [ ] 运行 `pnpm test:e2e`（Playwright 端到端），重点验证：
  - 会话消息流正常渲染
  - Task 工具子 Agent 内容可展开
  - ThinkingBlock 各自独立展开
  - 发送消息后自动滚动
- [ ] 检查 TypeScript strict 配置，确认无 `any` 新增
- [ ] 更新 `packages/client/src/features/session/types` 中的 `ContentBlock` 类型，添加 `_html?: string` 字段（替代散落的类型断言）

### 最终提交

```bash
git add -A
git commit -m "Session module architecture refactor: cleanup and final validation"
git push origin refactor/session-module-architecture
```

如有 PR 流程，此时创建 PR，附带：
- 本执行计划文档链接
- `pnpm test` / `pnpm test:e2e` / `pnpm typecheck` 的通过截图
- 关键变更说明（ThinkingBlock 独立状态、scrollTrigger 删除、AgentContent 归属）

---

## 测试策略总览

| 阶段 | 新增测试文件 | 测试重点 |
|------|------------|---------|
| Phase 1 | `ThinkingBlock.test.tsx` | 展开状态独立性 |
| Phase 2 | `MessageList.test.tsx` | ref handle 暴露，scrollToBottom 行为 |
| Phase 3 | `AgentContentContext.test.tsx` | inflight 去重，并发正确性，重试 |
| Phase 4 | `preprocessMessages.test.ts`、`WriteStdinRenderer.test.tsx`、`TaskRenderer.test.tsx` | 职责分离，工具 enrichment |
| Phase 5 | `AgentContentContext.test.tsx` (扩展) | state push 接口，useSession 返回类型 |
| Phase 6 | `ToolCallRow.test.tsx` | memo 稳定性 |
| Phase 7 | e2e (Playwright) | 全流程回归 |

所有测试文件遵循 CLAUDE.md 命名规范：`*.test.ts(x)`，位于对应包的 `test/` 目录或 `__tests__/` 子目录。

---

## 风险与回滚策略

| 阶段 | 主要风险 | 回滚方式 |
|------|---------|---------|
| Phase 1 | 无（纯减法） | `git revert` |
| Phase 2 | forwardRef 与 memo 组合的类型推断 | `git revert` |
| Phase 3 | inflight Promise 泄漏（try/finally 覆盖） | `git revert` |
| Phase 4 | WriteStdin enrichment 缺失（需 e2e 验证） | `git revert` |
| Phase 5 | useSession SSE 处理器与 context 的同步时序 | `git revert`，最高风险 |
| Phase 6 | 类型声明冲突（global.d.ts） | `git revert` |

**安全原则**：任何阶段失败时，`git revert <commit>` 回到上一个稳定点，不影响其他阶段的已有成果。
