import { getModelContextWindow } from "@scholaraio-hub/shared";
import { useCallback, useRef } from "react";
import { getSubagentRoute } from "../lib/subagentRouting";
import type { ContentBlock, Message } from "../types";
import { getStreamingEnabled } from "./useStreamingEnabled";

/** 流式 UI 更新节流间隔；过小会卡 React，过大会让用户感觉打字不顺滑 */
const STREAMING_THROTTLE_MS = 50;

/** 流式 markdown 事件回调集合（由 useSession 从 StreamingMarkdownContext 取出后透传进来） */
export interface StreamingMarkdownCallbacks {
  onAugment?: (augment: {
    blockIndex: number;
    html: string;
    type: string;
    messageId?: string;
  }) => void;
  onPending?: (pending: { html: string; messageId?: string }) => void;
  onStreamEnd?: (messageId?: string) => void;
}

/** 子 agent 的上下文消耗信息，用于在 Task 工具面板上展示进度条 */
export interface ContextUsage {
  inputTokens: number;
  percentage: number;
}

/** useStreamingContent hook 的入参 */
export interface UseStreamingContentOptions {
  /** 当流式消息需要更新到 React state 时回调 */
  onUpdateMessage: (message: Message, agentId?: string) => void;
  /** 流式 markdown 回调（透传给 StreamingMarkdownContext） */
  streamingMarkdownCallbacks?: StreamingMarkdownCallbacks;
  /** 发现新的 toolUseId → agentId 映射时回调（子 agent 路由） */
  onToolUseMapping?: (toolUseId: string, agentId: string) => void;
  /** 子 agent 上下文窗口使用率更新回调 */
  onAgentContextUsage?: (agentId: string, usage: ContextUsage) => void;
  /** 当流元数据没带 context window 时使用的兜底值 */
  contextWindowSize?: number;
}

/** useStreamingContent hook 的返回值 */
export interface UseStreamingContentResult {
  /** 处理一条 stream_event SSE 消息。返回 true 表示已处理完毕，false 表示该交给外层处理 */
  handleStreamEvent: (data: Record<string, unknown>) => boolean;
  /** 清空所有流式状态（在最终 assistant 消息到达时调用） */
  clearStreaming: () => void;
  /** 卸载清理（清定时器），useEffect 返回函数中调用 */
  cleanup: () => void;
}

/** 单条流式消息的内部累积状态 */
interface StreamingState {
  blocks: ContentBlock[];
  isStreaming: boolean;
  agentId?: string;
}

/**
 * 流式内容累积 hook。
 *
 * 职责：把 Anthropic SDK 的 stream_event 子事件序列
 *   message_start → content_block_start → content_block_delta* → content_block_stop
 *   → ...（多个 block 重复）→ message_stop
 * 累积成一条完整的 Message 对象，并以 50ms 节流更新到 React state。
 *
 * 关键设计：
 *  1. 数据先进 useRef Map（同步、高频），React state 通过节流批量更新（避免每个字符触发重渲染）。
 *  2. 用 message_start 里的 message.id 作为 streamingId，所有后续 delta 都归属到这个 ID。
 *  3. 通过 isSubagent + parentToolUseId / agentId 把子 agent 流分流到 agentContent。
 *  4. 主会话和子 agent 分别维护 route-local streamingId，避免交错流互相覆盖。
 */
export function useStreamingContent(
  options: UseStreamingContentOptions,
): UseStreamingContentResult {
  const {
    onUpdateMessage,
    streamingMarkdownCallbacks,
    onToolUseMapping,
    onAgentContextUsage,
    contextWindowSize: defaultContextWindowSize,
  } = options;

  // 当前所有进行中流式消息的累积状态。
  // key 是 message.id，value 是已累积的 ContentBlock 数组。
  // 用 ref 而非 state：delta 高频写入不能触发重渲染，state 更新由下面的节流统一刷。
  const streamingContentRef = useRef<Map<string, StreamingState>>(new Map());

  // Route key -> current streaming message id. This prevents a sidechain stream
  // from overwriting the main stream's current id when provider events interleave.
  const streamingIdByRouteRef = useRef<Map<string, string>>(new Map());

  // 节流批处理状态：所有 delta 把目标 messageId 塞进 pendingIds，
  // 50ms 内只起一次 timer，到期统一 flush 所有积压的 ID。
  // 这种 "leading + 合并" 模式比 lodash throttle 更轻量，且能合并不同消息的更新。
  const streamingThrottleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pendingIds: Set<string>;
  }>({ timer: null, pendingIds: new Set() });

  // 把 ref 里的累积内容构造成一条带 _isStreaming 标记的占位 Message，推给上层 React state。
  // 上层（useSessionMessages）会把这条占位消息合入 messages[]，
  // 等最终 assistant 消息来时再统一删除所有 _isStreaming 的占位。
  const updateStreamingMessage = useCallback(
    (messageId: string) => {
      const streaming = streamingContentRef.current.get(messageId);
      if (!streaming) return;

      const streamingMessage: Message = {
        id: messageId,
        type: "assistant",
        role: "assistant",
        message: {
          role: "assistant",
          content: streaming.blocks,
        },
        _isStreaming: true,
        _source: "sdk",
      };

      // agentId 不为空 → 上层路由到 agentContent[agentId] 而不是主 messages[]
      onUpdateMessage(streamingMessage, streaming.agentId);
    },
    [onUpdateMessage],
  );

  // 节流版的 updateStreamingMessage。
  // delta 调用时只把 messageId 入队，不立即 setState；
  // 由共享的 timer 到期时一次性 flush 队列里的所有 ID。
  const throttledUpdateStreamingMessage = useCallback(
    (messageId: string) => {
      const throttle = streamingThrottleRef.current;
      throttle.pendingIds.add(messageId);

      // 没有正在跑的 timer，立即起一个；50ms 后 flush
      if (!throttle.timer) {
        throttle.timer = setTimeout(() => {
          // 节流窗口结束，把队列里的所有目标都 flush 一遍
          for (const id of throttle.pendingIds) {
            updateStreamingMessage(id);
          }
          throttle.pendingIds.clear();
          throttle.timer = null;
        }, STREAMING_THROTTLE_MS);
      }
    },
    [updateStreamingMessage],
  );

  // 处理一条 stream_event SSE 消息。
  // 返回 true 代表已处理（外层不要再当作普通 message 处理），false 代表未处理。
  const handleStreamEvent = useCallback(
    (data: Record<string, unknown>): boolean => {
      // 只接 stream_event 类型，且全局开关打开（用户可关闭流式渲染优化降级）
      const msgType = data.type as string | undefined;
      if (msgType !== "stream_event" || !getStreamingEnabled()) {
        return false;
      }

      const event = data.event as Record<string, unknown> | undefined;
      if (!event) return true; // 算已处理但没有内容

      const eventType = event.type as string | undefined;

      const subagentRoute = getSubagentRoute(data);
      const routeKey = subagentRoute?.agentId ?? "__main__";
      const streamAgentId = subagentRoute?.agentId;

      // 把 toolUseId → agentId 映射告诉上层，让 TaskRenderer 渲染时能找到对应子 agent 的内容。
      // New SDK sidechain events may only have agentId; in that case there is no
      // parent tool id to register until the eventual tool_result text arrives.
      if (subagentRoute?.toolUseId && onToolUseMapping) {
        onToolUseMapping(subagentRoute.toolUseId, subagentRoute.agentId);
      }

      // message_start：第一个事件，携带本次流式消息的 API message id。
      // 后续所有 delta 都通过这个 id 关联回累积状态。
      if (eventType === "message_start") {
        const message = event.message as Record<string, unknown> | undefined;
        if (message?.id) {
          streamingIdByRouteRef.current.set(routeKey, message.id as string);

          // 子 agent 的上下文消耗只能在这里抓取，因为主消息的 usage
          // 要等流结束后从 JSONL 里取（带完整 input_tokens + cache stats）。
          if (streamAgentId && onAgentContextUsage) {
            const usage = message.usage as { input_tokens?: number } | undefined;
            if (usage?.input_tokens) {
              const inputTokens = usage.input_tokens;
              const model = typeof message.model === "string" ? message.model : undefined;
              const modelContextWindow =
                typeof message.model_context_window === "number"
                  ? message.model_context_window
                  : undefined;
              // 三级兜底：消息自带 → 按 model 查表 → 全局默认值
              const contextWindow =
                modelContextWindow && modelContextWindow > 0
                  ? modelContextWindow
                  : model
                    ? getModelContextWindow(model)
                    : (defaultContextWindowSize ?? getModelContextWindow(undefined));
              const percentage = (inputTokens / contextWindow) * 100;
              onAgentContextUsage(streamAgentId, { inputTokens, percentage });
            }
          }
        }
        return true;
      }

      // 后续事件如果 message_start 漏了（断线重连等异常），按 route 生成稳定兜底 ID。
      // 兜底 ID 必须写回 route map，否则同一条异常流的后续 delta 会落到不同占位消息。
      let streamingId = streamingIdByRouteRef.current.get(routeKey);
      if (!streamingId) {
        streamingId = `stream-${routeKey}-${Date.now()}`;
        streamingIdByRouteRef.current.set(routeKey, streamingId);
      }
      // Route by metadata on the current event. Falling back to a global
      // "current agent" would misroute main-session deltas after sidechain starts.
      const agentId = streamAgentId;

      // 不同 stream event 类型分支处理
      if (eventType === "content_block_start") {
        // 新 content block 开始（文本块 / thinking 块 / tool_use 块）
        const index = event.index as number;
        const contentBlock = event.content_block as Record<string, unknown> | null;
        if (contentBlock) {
          const streaming = streamingContentRef.current.get(streamingId) ?? {
            blocks: [],
            isStreaming: true,
            agentId, // 记录当前流式归属，updateStreamingMessage 据此决定路由
          };
          // 数组长度补齐到 index+1，避免 sparse array 渲染时下标错位
          while (streaming.blocks.length <= index) {
            streaming.blocks.push({ type: "text", text: "" });
          }
          // 初始化这个块（接下来的 delta 会往 text/thinking 字段累加）
          streaming.blocks[index] = {
            type: (contentBlock.type as string) ?? "text",
            text: (contentBlock.text as string) ?? "",
            thinking: (contentBlock.thinking as string) ?? undefined,
          };
          streamingContentRef.current.set(streamingId, streaming);
          // block_start 不走节流，立刻刷一次——让用户看到 "新段落开始了" 的反馈
          updateStreamingMessage(streamingId);
        }
      } else if (eventType === "content_block_delta") {
        // 增量内容——这是最高频的事件，每个字符一次，必须节流
        const index = event.index as number;
        const delta = event.delta as Record<string, unknown> | null;
        if (delta) {
          const streaming = streamingContentRef.current.get(streamingId);
          if (streaming?.blocks[index]) {
            const block = streaming.blocks[index];
            const deltaType = delta.type as string;
            // 区分两种 delta：普通文本 vs 内部思考
            if (deltaType === "text_delta" && delta.text) {
              block.text = (block.text ?? "") + (delta.text as string);
            } else if (deltaType === "thinking_delta" && delta.thinking) {
              block.thinking = (block.thinking ?? "") + (delta.thinking as string);
            }
            // 走节流：50ms 内多个 delta 只触发一次 setState
            throttledUpdateStreamingMessage(streamingId);
          }
        }
      } else if (eventType === "content_block_stop") {
        // 当前块结束。这里不需要做任何事——最终 assistant 消息会整体替换占位
      } else if (eventType === "message_stop") {
        // 消息流结束，清掉累积 ref。
        streamingContentRef.current.delete(streamingId);
        streamingIdByRouteRef.current.delete(routeKey);
        // 通知 streaming markdown 总线：流结束，TextBlock 该把 pending 区域清掉
        streamingMarkdownCallbacks?.onStreamEnd?.(streamingId);
      }

      return true; // 已处理
    },
    [
      updateStreamingMessage,
      throttledUpdateStreamingMessage,
      streamingMarkdownCallbacks,
      onToolUseMapping,
      onAgentContextUsage,
      defaultContextWindowSize,
    ],
  );

  // 清空所有流式状态。
  // 在最终 assistant 消息到达时由 useSession 调用，
  // 之后会把所有 _isStreaming 占位删掉，换成完整真实消息。
  const clearStreaming = useCallback(() => {
    streamingContentRef.current.clear();
    streamingIdByRouteRef.current.clear();
  }, []);

  // useEffect 卸载清理：清掉节流 timer，避免在已卸载组件上触发 setState
  const cleanup = useCallback(() => {
    if (streamingThrottleRef.current.timer) {
      clearTimeout(streamingThrottleRef.current.timer);
      streamingThrottleRef.current.timer = null;
    }
  }, []);

  return {
    handleStreamEvent,
    clearStreaming,
    cleanup,
  };
}
