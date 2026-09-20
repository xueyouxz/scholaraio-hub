# 计划：会话渲染管线 — 对齐 yepanywhere 与流式优化

> 状态：草案 / 待实施
> 作者：调研产出（2026-06-14）
> 事实源参考：`/Users/xyxz/Projects/JavaScript/yepanywhere`
> 关联记忆：`project_yepanywhere_alignment`（漂移修复 #1–#5）

## 背景与目标

会话消息的实时渲染管线已排查并修复两处问题（见「已完成基线」）。本计划收敛**剩余的对齐缺口与性能优化**，把它们拆成**可独立提交、可独立回滚**的阶段。

约束（沿用 `CLAUDE.md` 与 `.claude/rules`）：

- **不整体对齐**：scholaraio = yep 的裁剪分支 + scholar 产品层。只做「定点对齐 + 优化」，保留 scholar 层与被裁剪的 provider 集合。
- **每阶段一个独立 commit**：每阶段自带验证与回滚，互不依赖（除非显式标注 `blocked-by`）。
- **推送前 `pnpm ci:local`**：开启从未跑过的门禁视为迁移，先本地全绿。
- **无 bypass 注释**；空 `.catch` 必须记日志（`check-no-empty-catch` 钩子强制）。

### 架构现状（两边同构部分，不在本计划改动范围）

- 服务端把 markdown→HTML 渲染好（shiki 高亮 + safe-markdown sanitize），通过 SSE 的 `markdown-augment`（闭合块）/ `pending`（未闭合尾巴）事件下发；客户端 `innerHTML`，聊天路径**不跑** react-markdown。
- 增量按「块」计费：`BlockDetector` 检测块闭合，闭合块整块渲染一次；未闭合尾巴走廉价内联 HTML。
- 消息列表**未虚拟化**（yep 也未虚拟化，保持一致，不在本计划内）。

## 已完成基线（不在本计划阶段内，仅作上下文）

- **#4 流式不阻塞**：`packages/server/src/subscriptions.ts` 的 `case "message"` 对 `stream_event` 改为「先 `emit`、后台 `void` augment」，对齐 yep `subscriptions.ts:176-186`。含回归测试 `forwards stream_event deltas immediately without awaiting augmentation`。
- **#5 刷新闪 RUNNING**：`packages/client/src/app/pages/SessionPage.tsx` 用 `useNavigationType()`，仅 PUSH/REPLACE 采信 `location.state.initialStatus`，POP（刷新/前进后退）丢弃。**此为对 yep 的改进**（yep 同样有该 bug）。

---

## 阶段总览

| 阶段 | 模块 | 目标 | 端 | 风险 | 依赖 |
|------|------|------|----|------|------|
| P1 | shiki/augmenter 启动预热 | 消除首轮冷启动 1–3s 卡顿 | server | 低 | 无 |
| P2 | `wantsLiveDeltas` 服务端 opt-out | 关流式时服务端停做 delta 活 | client+server | 中 | 无 |
| P3 | 服务端 pending 合并/节流 | 降低每 token 的 augment 成本 | server | 中 | 建议在 P1 后 |
| P4 | `ExploredToolGroup` 折叠 | 只读探索类工具调用折叠成组 | client | 中 | 无 |
| P5 | `ThinkingText` 结构化渲染 | 思考文本按标题/代码分块 | client | 低 | 无 |
| P6 | `blocks/` 组件测试 | 渲染块补单测 | client | 低 | 建议在 P4/P5 后 |
| S1（拉伸） | WebSocket 传输 + ConnectionManager + lastEventId 回放 | 重连健壮性、断点续传 | client+server | 高 | 独立大改，可暂缓 |

每阶段的 commit subject 见各节「提交」。

---

## P1 — shiki / augmenter 启动预热

### 目标与依据
当前 `createStreamAugmenter` → `createStreamCoordinator` → `createAugmentGenerator` → shiki `createHighlighter` 全部懒加载（`packages/server/src/augments/markdown-augments.ts:49` 的 `generatorPromise` 单例、`augment-generator.ts:10` 的 shiki）。**首轮会话**第一条 delta 会卡在 shiki 冷加载（1–3s），表现为"开头一段一次性出现"。yep 同样懒加载（无优势），但 scholaraio 已有 `index.ts:182-183` 的 `warmProvider(...)` 启动预热先例，可顺势补 shiki 预热。

### 受影响文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/server/src/augments/markdown-augments.ts` | modify | 导出 `warmMarkdownAugments()`：`await renderMarkdownToHtml("\`\`\`ts\\nconst a=1\\n\`\`\`")` 触发 generator + shiki 实例化与常用语言加载 |
| `packages/server/src/index.ts` | modify | 启动序列里调用预热（紧随 `warmProvider` 之后），**带日志的 catch**（不可空 catch） |

> 备注：`stream-coordinator.ts:70` 用的是**独立**的 `createAugmentGenerator` 实例。若 coordinator 与 markdown-augments 不共享 highlighter 单例，需在 `augment-generator.ts` 暴露/复用同一个 `Highlighter`（shiki `createHighlighter` 自身较重）。**实施前先确认 highlighter 是否单例**——若不是，P1 顺带把 highlighter 收敛为模块级单例（仍属本阶段，低风险）。

### 步骤
- [ ] 1.1 确认 shiki highlighter 是否已是单例（`augment-generator.ts`）；若否，收敛为模块级单例 promise。
- [ ] 1.2 `markdown-augments.ts` 导出 `warmMarkdownAugments()`。
- [ ] 1.3 `index.ts` 启动调用 `warmMarkdownAugments().catch((err) => log.warn({ err }, "shiki warmup failed"))`。
- [ ] 验证：冷启动 server 后**首条** prompt 的流式从第一个 token 就增量出现（`window.__STREAMING_DEBUG__=true` 看 `[PENDING]` 是否从早期就持续打印，而非延迟到末尾）。
- [ ] 验证：`pnpm --filter @scholaraio-hub/server test`、`pnpm typecheck`、`pnpm lint` 全绿。

### 提交
`Warm shiki/markdown augmenter at server startup`

### 回滚
删除 `index.ts` 里的预热调用（一行）即可恢复懒加载；`warmMarkdownAugments` 导出无副作用，可保留或一并删。

### 风险
- 启动多 ~0.5–1s（一次性，非请求路径）。可接受。
- 若 highlighter 非单例被强制收敛，需回归 `augments/` 现有测试（`packages/server/test/augments`、`packages/server/test/highlighting`）。

---

## P2 — `wantsLiveDeltas` 服务端 opt-out

### 目标与依据
scholaraio 的 `useStreamingEnabled` 只挡**客户端** `handleStreamEvent`（`useStreamingContent.ts:156`），服务端仍对每条 `stream_event` 跑 augment 并下发 `pending`/`message`——用户关掉流式后服务端**白白耗 CPU/带宽**。yep 通过 `wantsLiveDeltas` 协商（`subscriptions.ts:95-98`、`Process.registerLiveDeltaSubscriber()`、订阅内 `subscriptions.ts:151` 直接 `break` 掉 live-delta 消息）让服务端整段跳过。

### 受影响文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/shared/src/session-stream.ts` | modify | （如需）约定 query 参数/类型 `wantsLiveDeltas` |
| `packages/client/src/features/session/hooks/useSessionStream.ts` | modify | EventSource URL 带 `?liveDeltas=0/1`，取值 `getStreamingEnabled()` |
| `packages/server/src/routes/streams.ts` | modify | 解析 query → 传入 `createSessionSubscription(..., { wantsLiveDeltas })` |
| `packages/server/src/subscriptions.ts` | modify | `wantsLiveDeltas===false` 时：`stream_event` 既不 augment 也不 emit（保留最终 assistant 消息路径） |
| `packages/server/test/subscriptions.test.ts` | modify | 加用例：`wantsLiveDeltas:false` 时 stream_event 不产生 `message`/`pending` |

> 注意：SSE 的 `EventSource` 改 URL 即可；切换流式开关需**重连**（与现有 `reconnect()` 配合）。`SubscriptionOptions` 增字段即可，**不必**引入 yep 的 `registerLiveDeltaSubscriber` 引用计数（那服务于 quiescence/liveness，scholaraio 现无该判定，避免过度移植）。

### 步骤
- [ ] 2.1 `subscriptions.ts`：`createSessionSubscription` 接受 `options.wantsLiveDeltas`（默认 true）；在 `case "message"` 对 `message.type==="stream_event"` 且 `!wantsLiveDeltas` 时直接 `break`。
- [ ] 2.2 `streams.ts`：从 `c.req.query("liveDeltas")` 解析并透传。
- [ ] 2.3 `useSessionStream.ts`：URL 拼 `liveDeltas`；`useStreamingEnabled` 变更时触发 reconnect。
- [ ] 2.4 补测试。
- [ ] 验证：关流式 → DevTools Network 看 SSE 流里不再有 `pending`/stream_event `message`，最终 assistant 仍到达并整段渲染。
- [ ] 验证：开流式 → 行为与现在一致。
- [ ] 验证：`pnpm ci:local`。

### 提交
`Skip live-delta augmentation server-side when streaming is disabled`

### 回滚
还原 4 个文件；`SubscriptionOptions` 的新字段有默认值，回滚后行为等价于"永远 wantsLiveDeltas"。

### 风险
- 开关切换需重连；确保重连后能正确补齐（现有 `connected` → `fetchNewMessages` 已覆盖）。
- shared 若加类型需先 build shared。

---

## P3 — 服务端 pending 合并 / 节流

### 目标与依据
`includePartialMessages` 下 `stream_event` ≈ 每 token 一条；唯一真正"按 token"付费的是 `renderStreamingCodeBlock`（正在写的代码块每 token 重新 shiki 高亮，见 `stream-coordinator.ts`）。客户端已有 50ms 节流，**服务端没有**。可在 augmenter 入口合并短时间内的多个 delta 再跑 coordinator/onChunk，显著降高频代码块场景的 CPU。

### 受影响文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/server/src/augments/stream-augmenter.ts` | modify | `processMessage` 的 text-delta 路径加合并窗口（如 ~33–50ms）：累计文本，到期 flush 一次 `processTextChunk`；流结束 `flush()` 强制清空 |
| `packages/server/test/augments/*` | modify | 加节流/flush 用例（用 fake timers） |

> 关键约束：节流**只能合并文本**（`text_delta`），不可推迟块闭合的 `markdown-augment` 正确性；`message_stop`/`isStreamingComplete` 必须立即 flush，保证不丢尾巴。资源释放：节流 timer 必须在订阅 cleanup / 流结束时清除（`.claude/rules` 资源释放路径）。

### 步骤
- [ ] 3.1 在 augmenter 内实现「leading + 合并」节流（参考客户端 `useStreamingContent` 的 pendingIds 模式）。
- [ ] 3.2 流结束/`flush()`/`reset()` 清 timer 并 flush 残留文本。
- [ ] 3.3 补 fake-timer 测试：N 个快速 delta 只触发 1 次 onChunk；结束时尾巴不丢。
- [ ] 验证：长代码块输出时服务端 CPU 明显下降；`pending` 帧率约束在节流窗口内；最终文本完整无截断。
- [ ] 验证：`pnpm ci:local`。

### 提交
`Coalesce streaming text deltas before markdown augmentation`

### 回滚
还原 `stream-augmenter.ts`（移除节流，恢复每 delta 即时 `processTextChunk`）。

### 风险
- 节流引入的"尾巴丢失"是主要风险 → 由"结束强制 flush"用例守护。
- 与 P2 解耦；但若 P2 已落地，关流式时本路径根本不执行，收益叠加。

---

## P4 — `ExploredToolGroup` 折叠

### 目标与依据
yep 有 `packages/client/src/components/blocks/ExploredToolGroup.tsx`，把**连续的只读"探索类"工具调用**（Read/Glob/Grep/LS 等）折叠成一组，时间线更干净。scholaraio 无（`blocks/` 缺该文件）。

### 受影响文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/client/src/features/session/components/blocks/ExploredToolGroup.tsx` | create | 折叠组组件（移植 + 适配 scholaraio 的工具渲染器/类型） |
| `packages/client/src/features/session/lib/renderItems.ts` | modify | 在构建 RenderItem 时识别连续只读工具序列，产出 `tool_group` 项 |
| `packages/client/src/features/session/types/renderItems.ts` | modify | 增 `tool_group` RenderItem 类型 |
| `packages/client/src/features/session/components/RenderItemComponent.tsx` | modify | `case "tool_group"` 渲染 `ExploredToolGroup` |
| `packages/client/src/features/session/lib/__tests__/...` | create/modify | 分组逻辑单测（哪些工具算只读、如何断组） |

> 先确认 scholaraio 现有"只读工具"的判定来源（工具渲染器 registry / 工具名单），复用而非新造一份名单（`.claude/rules/client.md` 共享派生数据原则）。

### 步骤
- [ ] 4.1 复用/定义只读工具判定（单一来源）。
- [ ] 4.2 `renderItems.ts` 增分组归并（连续只读 → 一个 `tool_group`，被非只读/文本打断则收口）。
- [ ] 4.3 类型 + `RenderItemComponent` + 组件。
- [ ] 4.4 单测分组边界。
- [ ] 验证：含多次 Read/Grep 的会话时间线折叠正确；展开/折叠交互正常；流式中新加只读调用能并入当前组。
- [ ] 验证：`pnpm --filter @scholaraio-hub/client test`、typecheck、lint。

### 提交
`Add ExploredToolGroup to collapse consecutive read-only tool calls`

### 回滚
移除 `case "tool_group"` 与 `renderItems.ts` 分组逻辑、删组件与类型；RenderItem 退回逐条渲染。

### 风险
- 分组边界（流式中途、子 agent 路由 `subagentRouting`）易错 → 单测覆盖断组/并组/子 agent 分流。
- 与既有 `RenderItemComponent` memo 化交互，注意 key 稳定性。

---

## P5 — `ThinkingText` 结构化渲染

### 目标与依据
yep 有 `ThinkingText.tsx`：按 `**标题**` 把思考文本切成段落/代码块结构化展示。scholaraio 的 `blocks/ThinkingBlock.tsx` 较朴素。

### 受影响文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/client/src/features/session/components/blocks/ThinkingBlock.tsx` | modify | 引入标题/代码分块解析（移植 yep `ThinkingText` 的 `splitThinkingBlocks`/heading 逻辑） |
| `packages/client/src/features/session/components/blocks/__tests__/ThinkingBlock.test.tsx` | create | 解析用例 |

### 步骤
- [ ] 5.1 移植解析函数（纯函数，易测）。
- [ ] 5.2 `ThinkingBlock` 用结构化输出渲染；保持流式增量兼容（思考也会增量增长）。
- [ ] 5.3 单测。
- [ ] 验证：思考块按标题分节展示；流式增长不抖动。
- [ ] 验证：client test/typecheck/lint。

### 提交
`Render thinking text with structured headings and code blocks`

### 回滚
还原 `ThinkingBlock.tsx`。

### 风险
- 低。注意纯展示，不改数据流。

---

## P6 — `blocks/` 组件测试补齐

### 目标与依据
yep `components/blocks/__tests__` 有渲染块测试，scholaraio `features/session/components/blocks/` 无测试。补齐 `TextBlock`/`ThinkingBlock`/`ToolCallRow`/`UserPromptBlock`/`SessionSetupBlock`（及 P4 的 `ExploredToolGroup`）。

### 受影响文件
| 文件 | 改动 |
|------|------|
| `packages/client/src/features/session/components/blocks/__tests__/*.test.tsx` | create |

### 步骤
- [ ] 6.1 为各 block 写最小渲染/分支测试（含 `TextBlock` 的 streaming/augmentHtml/纯文本三态）。
- [ ] 验证：client test 全绿且新增有意义断言。

### 提交
`Add component tests for session render blocks`

### 回滚
删测试文件（无生产代码改动）。

### 风险
- 极低；纯增测试。建议放在 P4/P5 之后，覆盖新代码。

---

## S1（拉伸，可暂缓）— WebSocket 传输 + ConnectionManager + lastEventId 回放

### 目标与依据
yep 会话流走 WebSocket + `ConnectionManager`（退避重连/状态机）+ `lastEventId` 断点续传（`useSessionStream.ts`）。scholaraio 用纯 SSE（功能够用，但重连较弱、无断点续传）。这是**大改、高风险**，与本计划其余阶段解耦，仅在重连/弱网体验成为痛点时再启动，单独立项。

### 不在本阶段细化
仅登记为后续候选；若实施需独立的设计文档（传输抽象、relay 兼容、回放语义、与 scholar 安全模型 `ScholarAIO-Hub` 头/host 白名单的配合）。

---

## 跨阶段验证

每阶段完成后：

1. `pnpm typecheck` · `pnpm lint` · 对应包 `test`。
2. 推送前 `pnpm ci:local`（必要时 `--audit`）。
3. 手动冒烟：发一条会触发代码块 + 工具调用 + 思考的 prompt，开/关流式各一次，刷新页面一次。

## 整体风险与缓解

- **并发访问有状态 coordinator**（P3 改动区）：节流后 onChunk 频次降低，反而减小并发面；仍保持 augment 的 FIFO 语义（沿用 `void` + `.then` 顺序）。
- **过度移植**：S1 与 `registerLiveDeltaSubscriber` 引用计数等 yep 机制服务于 yep 独有的 quiescence/relay，**不要**为对齐而对齐（见 `project_yepanywhere_alignment`）。
- **scholar 层耦合**：P2 改 SSE URL 时注意 `ScholarAIO-Hub` CSRF 头与 host 白名单中间件（`project_security_model`）不受影响。

## 建议实施顺序

P1 →（P2 ∥ P4 ∥ P5 互相独立）→ P3 → P6 →（按需）S1。
其中 **P1 投入最小、直接改善首轮"一次性出现"**，建议最先做。
