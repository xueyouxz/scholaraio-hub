# Refactor Plan: Session Module Alignment

## Current State

`packages/client/src/features/session/` 和 `packages/client/src/app/pages/` 实现了会话功能，但与模板代码（`temp/client/`）存在多处架构偏差、参数缺失和功能缺失。核心问题集中在三个区域：

1. **API 层**：`features/session/api/client.ts` 中有多个接口参数缺失或返回类型错误
2. **SessionPage**：Nav state 命名错误导致运行时 bug，缺少大量 UX 功能
3. **NewSessionPage**：与 SessionPage 的 nav state 契约不匹配

## Target State

- `features/session/api/client.ts`：所有接口参数与服务端路由一致，无多余客户端聚合逻辑
- `app/pages/SessionPage.tsx`：完整的会话体验（元数据操作、中断/恢复、自动重试、AskUserQuestion 支持）
- `app/pages/NewSessionPage.tsx`：nav state 与 SessionPage 期望契约对齐
- `features/session/hooks/useFileActivity.ts`：去除多余的 `activityBus.connect()` 调用

---

## Affected Files

| 文件 | 变更类型 | 依赖关系 |
|------|----------|----------|
| `features/session/api/client.ts` | modify | 被 SessionPage、NewSessionPage、useGlobalSessions 依赖 |
| `features/session/hooks/useFileActivity.ts` | modify | 被 useGlobalSessions 等所有 SSE 订阅者依赖 |
| `app/pages/NewSessionPage.tsx` | modify | 阻塞 SessionPage P0 修复 |
| `app/pages/SessionPage.tsx` | modify | 被 router 挂载，依赖 api/client、useSession |
| `features/session/components/ToolApprovalPanel.tsx` | create | 被 SessionPage 依赖 |
| `features/session/components/QuestionAnswerPanel.tsx` | create | 被 SessionPage 依赖；需要 `respondToInput answers` API 先修复 |
| `features/session/hooks/useEngagementTracking.ts` | create | 被 SessionPage 依赖 |
| `features/session/api/client.test.ts` | create | 验证 Phase 1 修复 |

---

## Execution Plan

### Phase 1: API 层修复（P0 Bug + 接口对齐）

> 目标：所有 API 调用与服务端路由签名一致。先改 API 层，后改调用方。

- [ ] **1.1** `features/session/api/client.ts`：修复 `cancelDeferredMessage`，补充 `encodeURIComponent`

  ```ts
  // Before (line 304):
  cancelDeferredMessage: (sessionId: string, tempId: string) =>
    requestJson<{ cancelled: boolean }>(`/api/sessions/${sessionId}/deferred/${tempId}`, {

  // After:
  cancelDeferredMessage: (sessionId: string, tempId: string) =>
    requestJson<{ cancelled: boolean }>(`/api/sessions/${sessionId}/deferred/${encodeURIComponent(tempId)}`, {
  ```

- [ ] **1.2** `features/session/api/client.ts`：修复 `markSessionSeen` 和 `markSessionUnread` 返回类型

  ```ts
  // Before: Promise<{ success: boolean }>
  // After:  Promise<{ marked: boolean }>
  markSessionSeen: (sessionId: string, messageId?: string) =>
    requestJson<{ marked: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
  markSessionUnread: (sessionId: string) =>
    requestJson<{ marked: boolean }>(`/api/sessions/${sessionId}/mark-seen`, {
  ```

- [ ] **1.3** `features/session/api/client.ts`：补充 `respondToInput` 的 `answers` 参数（服务端 `body.answers` 已实现）

  修改调用方 `app/pages/SessionPage.tsx` 中 `respondToPendingInput` 一并传递 `answers`。

- [ ] **1.4** `features/session/api/client.ts`：补充 `cloneSession`、`getProcessInfo` 两个新方法

  ```ts
  cloneSession: (projectId: string, sessionId: string) =>
    requestJson<{ session: AppSessionSummary }>(
      `/api/projects/${projectId}/sessions/${sessionId}/clone`,
      { method: "POST" },
    ),

  getProcessInfo: (sessionId: string) =>
    requestJson<ProcessInfo>(`/api/sessions/${sessionId}/process`),
  ```

- [ ] **验证**：`pnpm typecheck` 通过，无新 TS 错误

---

### Phase 2: Nav State 修复（P0 运行时 Bug）

> `NewSessionPage` 传 `initialOwnership`，`SessionPage` 读 `initialOwnership`（line 24），但 `useSession` 第三个参数期望 `{ owner: "self"; processId: string }` 类型（即 `SessionOwnership` 的 self 变体）。目前逻辑 `initialOwnership?.owner === "self" ? initialOwnership : undefined` 实际上能读到值，但 `SessionPage` 的 nav state 类型声明与模板不一致，后续若在 SessionPage 内添加 `initialProvider`、`initialModel` 时会引发问题。本 phase 统一类型声明。

- [ ] **2.1** 新增 `SessionNavState` 类型（可放在 `features/session/types.ts`）

  ```ts
  export interface SessionNavState {
    initialStatus?: { owner: "self"; processId: string };
    initialTitle?: string;
    initialProvider?: ProviderName;
    initialModel?: string;
  }
  ```

- [ ] **2.2** `app/pages/NewSessionPage.tsx`：将 nav state 字段改为 `initialStatus`

  ```ts
  // Before (lines 88-91 and 103-106):
  state: {
    initialOwnership: { owner: "self" as const, processId: resumed.processId },
    initialTitle: message.trim(),
  }

  // After:
  state: {
    initialStatus: { owner: "self" as const, processId: resumed.processId },
    initialTitle: message.trim(),
    initialProvider: selectedProvider,
    initialModel: selectedModel,
  } satisfies SessionNavState
  ```

- [ ] **2.3** `app/pages/SessionPage.tsx`：更新 nav state 读取使用 `SessionNavState`

  ```ts
  const navState = location.state as SessionNavState | null;
  // 将所有 navState?.initialOwnership 改为 navState?.initialStatus
  ```

- [ ] **验证**：`pnpm typecheck`，然后本地启动，新建会话并确认跳转后 session 立即进入 `owner: "self"` 状态

---

### Phase 3: 移除冗余代码

- [ ] **3.1** `features/session/hooks/useFileActivity.ts`：删除多余的 `activityBus.connect()` useEffect（lines 97-99）

  > activityBus 连接由 App 层统一管理，hook 不应重复 connect。

- [ ] **3.2** `app/pages/SessionPage.tsx`：删除本地 `composerPermissionMode` state 和同步 useEffect

  ```ts
  // 删除:
  const [composerPermissionMode, setComposerPermissionMode] = useState<PermissionMode>("default");
  useEffect(() => {
    if (permissionMode) setComposerPermissionMode(permissionMode);
  }, [permissionMode]);
  ```

  > 直接使用 `useSession` 返回的 `permissionMode`，通过 `setPermissionMode` 更新。

- [ ] **3.3** `app/pages/SessionPage.tsx`：删除本地 `isHeld` state 和同步 useEffect

  ```ts
  // 删除:
  const [isHeld, setIsHeld] = useState(false);
  useEffect(() => { setIsHeld(sessionIsHeld); }, [sessionIsHeld]);
  ```

  > 直接使用 `useSession` 返回的 `isHeld`（已命名为 `sessionIsHeld`）。

- [ ] **3.4** `app/pages/SessionPage.tsx`：删除手动 model 加载 useEffect

  ```ts
  // 删除:
  useEffect(() => {
    if (!session?.provider) return;
    api.getProviders().then((data) => { ... });
  }, [session?.provider, session?.model]);
  ```

  > 替换为 Phase 4 中引入的 `useProviders()` hook。

- [ ] **3.5** `app/pages/NewSessionPage.tsx`：删除手动 provider 加载 useEffect

  ```ts
  // 删除:
  useEffect(() => {
    if (!selectedProvider) return;
    api.getProviders().then((data) => { ... });
  }, [selectedProvider]);
  ```

- [ ] **验证**：`pnpm lint:fix && pnpm typecheck`

---

### Phase 4: 架构迁移

#### 4.1 `handleAbort` 级联策略

- [ ] `app/pages/SessionPage.tsx`：将 `handleStop` 改为先 `interruptProcess`，失败再 `abortProcess`

  ```ts
  const handleStop = useCallback(async () => {
    if (ownership.owner !== "self") return;
    try {
      await api.interruptProcess(ownership.processId);
    } catch {
      await api.abortProcess(ownership.processId).catch(() => {});
      setStatus({ owner: "none" });
      setProcessState("idle");
    }
  }, [ownership, setStatus, setProcessState]);
  ```

#### 4.2 `pendingUploadsRef` 上传追踪

- [ ] `app/pages/SessionPage.tsx`：将 `Promise.all(files.map(...))` 替换为 `pendingUploadsRef` 模式

  ```ts
  const pendingUploadsRef = useRef<Map<string, Promise<UploadedFile | null>>>(new Map());

  const uploadFiles = useCallback(async (files: File[]): Promise<UploadedFile[]> => {
    const results = await Promise.all(
      files.map(async (file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        let pending = pendingUploadsRef.current.get(key);
        if (!pending) {
          pending = api.uploadAttachment(projectId, sessionId, file).catch(() => null);
          pendingUploadsRef.current.set(key, pending);
        }
        const result = await pending;
        pendingUploadsRef.current.delete(key);
        return result;
      }),
    );
    return results.filter((r): r is UploadedFile => r !== null);
  }, [projectId, sessionId]);
  ```

#### 4.3 `draftControlsRef` 草稿持久化

- [ ] `app/pages/SessionPage.tsx`：新增 `draftControlsRef`，发送成功清除草稿，失败恢复草稿

  ```ts
  interface DraftControls {
    clearDraft: () => void;
    restoreFromStorage: () => void;
  }
  const draftControlsRef = useRef<DraftControls | null>(null);

  // 发送成功后：
  draftControlsRef.current?.clearDraft();

  // 发送失败后（catch 块）：
  draftControlsRef.current?.restoreFromStorage();
  ```

  > `MessageInput` 需要通过 `ref` 或 prop callback 暴露 `clearDraft` / `restoreFromStorage`。
  > 参考 `features/session/hooks/useDraftPersistence.ts`（已存在）。

#### 4.4 `useProviders()` 替换手动 provider 加载

- [ ] 确认 `features/session/hooks/` 中是否已有 `useProviders` hook，若无则新建

  ```ts
  // features/session/hooks/useProviders.ts
  export function useProviders(providerName?: ProviderName) {
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    useEffect(() => {
      api.getProviders().then((data) => setProviders(data.providers));
    }, []);
    const provider = providerName ? providers.find((p) => p.name === providerName) : undefined;
    return { providers, models: provider?.models ?? [], capabilities: provider };
  }
  ```

- [ ] `app/pages/SessionPage.tsx` 和 `app/pages/NewSessionPage.tsx`：改用 `useProviders(session?.provider)`

#### 4.5 `SessionMetadataProvider` 位置修正

- [ ] `app/pages/SessionPage.tsx`：将 `SessionMetadataProvider` 从 `SessionPage` 顶层移入 `SessionPageContent` 内、loading 完成后

  ```tsx
  // 当前：SessionMetadataProvider 包裹整个 SessionPage（含 loading 状态）
  // 修复后：移到 SessionPageContent 内，session 数据确认加载后挂载
  {!loading && session && (
    <SessionMetadataProvider projectId={projectId} projectPath={null} sessionId={actualSessionId}>
      {/* 内容 */}
    </SessionMetadataProvider>
  )}
  ```

#### 4.6 `actualSessionId` URL 替换导航

- [ ] `app/pages/SessionPage.tsx`：`useSession` 返回 `actualSessionId`，当其与路由 `sessionId` 不同时执行 replace 导航

  ```ts
  const { actualSessionId, ...rest } = useSession(...);

  useEffect(() => {
    if (actualSessionId && actualSessionId !== sessionId) {
      navigate(
        `/projects/${projectId}/sessions/${actualSessionId}`,
        { replace: true },
      );
    }
  }, [actualSessionId, sessionId, projectId, navigate]);
  ```

- [ ] **验证**：`pnpm typecheck`，本地测试 session clone / redirect 场景

---

### Phase 5: 补充功能组件

#### 5.1 `useEngagementTracking` Hook

- [ ] 新建 `features/session/hooks/useEngagementTracking.ts`

  ```ts
  const ENGAGEMENT_DELAY_MS = 2000;

  export function useEngagementTracking(sessionId: string | undefined) {
    useEffect(() => {
      if (!sessionId) return;
      const timer = setTimeout(() => {
        sessionApi.markSessionSeen(sessionId).catch(() => {});
      }, ENGAGEMENT_DELAY_MS);
      return () => clearTimeout(timer);
    }, [sessionId]);
  }
  ```

- [ ] `app/pages/SessionPage.tsx`：在 `SessionPageContent` 中调用 `useEngagementTracking(actualSessionId ?? sessionId)`

#### 5.2 `ToolApprovalPanel` 组件

- [ ] 新建 `features/session/components/ToolApprovalPanel.tsx`

  将 `SessionPage.tsx` 中的内联 tool approval 渲染逻辑（lines 357-391）提取为独立组件，接口：

  ```ts
  interface ToolApprovalPanelProps {
    request: InputRequest;
    onApprove: () => void;
    onApproveAcceptEdits: () => void;
    onDeny: () => void;
  }
  ```

#### 5.3 `QuestionAnswerPanel` 组件（AskUserQuestion 支持）

- [ ] 新建 `features/session/components/QuestionAnswerPanel.tsx`

  ```ts
  interface QuestionAnswerPanelProps {
    request: InputRequest; // type === "question"
    onAnswer: (answers: Record<string, string>) => void;
  }
  ```

- [ ] `app/pages/SessionPage.tsx`：根据 `pendingInputRequest.type` 分发到 `ToolApprovalPanel` 或 `QuestionAnswerPanel`

  ```tsx
  {pendingInputRequest?.type === "question" ? (
    <QuestionAnswerPanel
      request={pendingInputRequest}
      onAnswer={(answers) => void respondToPendingInput("approve", answers)}
    />
  ) : pendingInputRequest ? (
    <ToolApprovalPanel
      request={pendingInputRequest}
      onApprove={() => void respondToPendingInput("approve")}
      onApproveAcceptEdits={() => void respondToPendingInput("approve_accept_edits")}
      onDeny={() => void respondToPendingInput("deny")}
    />
  ) : null}
  ```

- [ ] `respondToPendingInput` 函数补充 `answers` 参数传递给 `api.respondToInput`

#### 5.4 Session 元数据操作工具栏

- [ ] `app/pages/SessionPage.tsx`：在 header 区域添加操作按钮（收藏、归档、重命名）

  - **收藏**：调用 `api.updateSessionMetadata(sessionId, { starred: !session.isStarred })`
  - **归档**：调用 `api.updateSessionMetadata(sessionId, { archived: !session.isArchived })`
  - **重命名**（内联编辑）：双击标题进入编辑，Enter 保存，Escape 取消，调用 `api.updateSessionMetadata(sessionId, { title })`
  - **克隆**（Phase 1 已加 API）：调用 `api.cloneSession(projectId, sessionId)` 后导航到新 session

#### 5.5 `hasPendingToolCalls` 非 owner 警告

- [ ] `app/pages/SessionPage.tsx`：当 `ownership.owner !== "self"` 且有待处理 tool calls 时显示提示

  ```tsx
  {ownership.owner !== "self" && pendingInputRequest && (
    <div className="mx-auto w-full max-w-[830px] mt-2 px-4 py-2 rounded-lg bg-warning-container/20 text-warning text-xs">
      此会话正在等待工具调用审批，切换到 Owner 后才能处理。
    </div>
  )}
  ```

- [ ] **验证**：`pnpm lint:fix && pnpm typecheck`，本地测试各元数据操作

---

### Phase 6: 测试

- [ ] **6.1** 新建 `features/session/api/client.test.ts`，覆盖以下用例：

  | 测试用例 | 验证点 |
  |----------|--------|
  | `cancelDeferredMessage` 特殊字符 tempId | URL 中 `/`、`?`、`=` 被正确编码 |
  | `markSessionSeen` 响应处理 | 能正确读取 `{ marked: boolean }` 而非 `{ success }` |
  | `respondToInput` 含 `answers` | POST body 包含 `answers` 字段 |
  | `cloneSession` 成功路径 | 返回新 session 对象 |

- [ ] **6.2** `features/session/hooks/useEngagementTracking.test.ts`：

  | 测试用例 | 验证点 |
  |----------|--------|
  | sessionId 存在时 | 延迟后调用 `markSessionSeen` |
  | sessionId 为 undefined | 不调用 `markSessionSeen` |
  | 组件卸载时 | 清除 timer，不发请求 |
  | sessionId 变化时 | 重置 timer |

- [ ] **6.3** `app/pages/SessionPage.test.tsx`（或集成测试）：

  | 测试用例 | 验证点 |
  |----------|--------|
  | `handleStop` 先调 interrupt | `interruptProcess` 被调用 |
  | `handleStop` interrupt 失败 | fallback 到 `abortProcess` |
  | 发送失败恢复草稿 | `draftControlsRef.restoreFromStorage` 被调用 |

- [ ] **6.4** Nav state 集成测试：

  | 测试用例 | 验证点 |
  |----------|--------|
  | NewSessionPage 导航后 state | state 中包含 `initialStatus`（非 `initialOwnership`） |
  | SessionPage 读取 `initialStatus` | `useSession` 第三参数为正确的 ownership 对象 |

- [ ] **6.5** 运行全量测试：`pnpm test && pnpm typecheck`

---

### Phase 7: 清理

- [ ] **7.1** 确认 `getProjectSessionsAsGlobal` 及 `toGlobalSession` 是否仍被引用；若服务端已实现 `/api/sessions` 全局端点则移除，否则保留并添加注释说明这是临时的 N+1 聚合实现
- [ ] **7.2** 检查 `features/session/api/client.ts` 中是否有与 `core/api.ts` 重复定义的代理方法（如 `abortProcess`、`interruptProcess`），确认去重
- [ ] **7.3** 更新 `packages/client/src/features/session/i18n.tsx` 中与新组件相关的文案（如 `QuestionAnswerPanel` 按钮文字）
- [ ] **7.4** 最终：`pnpm lint:fix && pnpm test && pnpm typecheck`

---

## Rollback Plan

1. **Phase 1 回滚**：所有改动均在 `api/client.ts` 内，`git checkout packages/client/src/features/session/api/client.ts` 即可
2. **Phase 2 回滚**：`git checkout packages/client/src/app/pages/NewSessionPage.tsx packages/client/src/app/pages/SessionPage.tsx`
3. **Phase 3-4 回滚**：同上，各 Phase 改动文件独立，可单独回滚
4. **Phase 5 回滚**：新建文件直接删除，不影响已有代码

建议每个 Phase 完成后单独提交，便于精确回滚。

---

## Risks

| 风险 | 缓解措施 |
|------|----------|
| `cancelDeferredMessage` URL 编码可能影响现有已缓存的 deferred tempId | tempId 由客户端生成（`addPendingMessage`），格式固定为 UUID，通常不含特殊字符；编码后行为向后兼容 |
| 移除 `activityBus.connect()` 后 SSE 断连 | 确认 `App.tsx` 或 `activityBus` 初始化已在 App 层建立连接，本地测试 SSE 事件流正常 |
| `SessionMetadataProvider` 位置变更导致子组件 context 丢失 | 移动前确认所有 `useSessionMetadata()` 调用都在新位置的子树内 |
| `draftControlsRef` 依赖 `MessageInput` 暴露 ref | 需同步修改 `MessageInput` 组件接口；`useDraftPersistence` hook 已存在可直接复用 |
| `respondToInput` 补充 `answers` 参数 | 服务端已读取 `body.answers`，若传 `undefined` 则无影响，向前兼容 |
