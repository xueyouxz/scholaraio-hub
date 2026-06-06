import { type ReactNode, createContext, useCallback, useContext, useRef } from "react";
import type { AugmentEvent, PendingEvent } from "../hooks/useStreamingMarkdown";

/** 当前正在流式输出的 TextBlock 向本 Context 注册的回调集合。 */
interface StreamingHandlers {
  /** 完整 markdown block 闭合时触发（如代码块、段落、表格） */
  onAugment: (augment: AugmentEvent) => void;
  /** 未闭合的尾巴文本，每个 text delta 都会触发一次 */
  onPending: (pending: PendingEvent) => void;
  /** 流结束信号，TextBlock 据此把 pending 清掉 */
  onStreamEnd: () => void;
}

/**
 * 流式 markdown 事件总线的 Context value。
 *
 * 设计动机：SSE 来的 augment/pending 事件需要送达 "正在流式的 TextBlock"，
 * 但 TextBlock 是嵌在 MessageList → RenderItem → ContentBlockRenderer 多层之下的，
 * 用 props 透传会污染所有中间层。所以用 Context 做"单注册位事件总线"：
 *   - dispatch* 由 useSession 在收到 SSE 事件时调用（事件源）
 *   - registerStreamingHandler 由当前流式 TextBlock 在 mount 时调用（订阅方）
 * 通常只有一个 TextBlock 处于流式态；当主会话和子 agent 流交错时，
 * 用 messageId 精确派发到对应 TextBlock。
 */
interface StreamingMarkdownContextValue {
  /**
   * 把当前 TextBlock 注册为流式接收方。
   * messageId 存在时按 messageId 路由；否则退化为最新注册 handler。
   * 返回 unregister 函数；该函数只有在 "当前 handler 仍是自己" 时才清掉，
   * 避免 React 严格模式下 cleanup 顺序与 mount 顺序错乱导致误清。
   */
  registerStreamingHandler: (handlers: StreamingHandlers, messageId?: string) => () => void;

  /** 向当前注册 handler 派发一个已闭合的 markdown 块（augment 事件） */
  dispatchAugment: (augment: AugmentEvent) => void;

  /** 向当前注册 handler 派发一段还在打字的 inline HTML（pending 事件） */
  dispatchPending: (pending: PendingEvent) => void;

  /** 通知流已结束 */
  dispatchStreamEnd: (messageId?: string) => void;
}

const StreamingMarkdownContext = createContext<StreamingMarkdownContextValue | null>(null);

interface StreamingMarkdownProviderProps {
  children: ReactNode;
}

/**
 * 流式 markdown 事件总线 Provider。
 *
 * 桥接两端：
 *   ① 事件源（useSession 收到 SSE 的 markdown-augment / pending 事件）
 *   ② 订阅方（当前正在流式的 TextBlock 通过 useStreamingMarkdown 注册 handler）
 *
 * 用 ref 存 handler 而不是 state 的原因：
 *   - handler 变更不应触发任何重渲染
 *   - dispatch* 在每个 text delta 都被调用，几十毫秒一次，必须 O(1)
 */
export function StreamingMarkdownProvider({ children }: StreamingMarkdownProviderProps) {
  // 最新注册的 handler 是没有 messageId 时的兜底接收方。
  const handlersRef = useRef<StreamingHandlers | null>(null);
  const handlersByMessageIdRef = useRef<Map<string, StreamingHandlers>>(new Map());
  const queuedAugmentsByMessageIdRef = useRef<Map<string, AugmentEvent[]>>(new Map());
  const queuedPendingByMessageIdRef = useRef<Map<string, PendingEvent>>(new Map());

  const registerStreamingHandler = useCallback(
    (handlers: StreamingHandlers, messageId?: string): (() => void) => {
      if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
        console.log("%c[CONTEXT] Handler registered", "color: #2196F3", {
          hadPreviousHandler: !!handlersRef.current,
          messageId,
        });
      }
      handlersRef.current = handlers;
      if (messageId) {
        handlersByMessageIdRef.current.set(messageId, handlers);
        const queuedAugments = queuedAugmentsByMessageIdRef.current.get(messageId);
        if (queuedAugments) {
          queuedAugmentsByMessageIdRef.current.delete(messageId);
          for (const augment of queuedAugments) {
            handlers.onAugment(augment);
          }
        }
        const queuedPending = queuedPendingByMessageIdRef.current.get(messageId);
        if (queuedPending) {
          queuedPendingByMessageIdRef.current.delete(messageId);
          handlers.onPending(queuedPending);
        }
      }
      return () => {
        if (messageId && handlersByMessageIdRef.current.get(messageId) === handlers) {
          handlersByMessageIdRef.current.delete(messageId);
        }

        // 仅在当前 handler 仍是本次注册的 handler 时才清空
        // 这是为了应对 React 18+ 严格模式下 effect 的 mount/unmount 双触发：
        // 假如 TextBlock A 先注册，B 后注册覆盖了 A，A 的 cleanup 才执行——
        // 此时 handlersRef 已经是 B 的 handler，不能误清 B
        if (handlersRef.current === handlers) {
          if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
            console.log("%c[CONTEXT] Handler unregistered", "color: #FF5722");
          }
          handlersRef.current = null;
        }
      };
    },
    [],
  );

  const dispatchAugment = useCallback((augment: AugmentEvent) => {
    const targetHandler = augment.messageId
      ? handlersByMessageIdRef.current.get(augment.messageId)
      : undefined;
    const fallbackHandler = augment.messageId ? undefined : handlersRef.current;
    if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
      console.log("%c[CONTEXT] dispatchAugment called", "color: #4CAF50", {
        hasHandler: !!(targetHandler ?? fallbackHandler),
        augment: {
          blockIndex: augment.blockIndex,
          type: augment.type,
          messageId: augment.messageId,
        },
      });
    }
    const handler = targetHandler ?? fallbackHandler;
    if (handler) {
      handler.onAugment(augment);
      return;
    }

    // 有 messageId 的事件不能退化到最新 handler，否则主会话和子 agent 交错时会串流。
    // TextBlock 可能还没 mount，先缓冲，注册时按 messageId 精确补发。
    if (augment.messageId) {
      const queued = queuedAugmentsByMessageIdRef.current.get(augment.messageId) ?? [];
      queued.push(augment);
      queuedAugmentsByMessageIdRef.current.set(augment.messageId, queued);
    }
  }, []);

  const dispatchPending = useCallback((pending: PendingEvent) => {
    const targetHandler = pending.messageId
      ? handlersByMessageIdRef.current.get(pending.messageId)
      : undefined;
    const fallbackHandler = pending.messageId ? undefined : handlersRef.current;
    if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
      console.log("%c[CONTEXT] dispatchPending called", "color: #FF9800", {
        hasHandler: !!(targetHandler ?? fallbackHandler),
        htmlLength: pending.html.length,
        messageId: pending.messageId,
      });
    }
    const handler = targetHandler ?? fallbackHandler;
    if (handler) {
      handler.onPending(pending);
      return;
    }

    // pending 是快照，只保留同一 messageId 的最新一帧，避免队列无界增长。
    if (pending.messageId) {
      queuedPendingByMessageIdRef.current.set(pending.messageId, pending);
    }
  }, []);

  const dispatchStreamEnd = useCallback((messageId?: string) => {
    const targetHandler = messageId ? handlersByMessageIdRef.current.get(messageId) : undefined;
    const fallbackHandler = messageId ? undefined : handlersRef.current;
    (targetHandler ?? fallbackHandler)?.onStreamEnd();
    if (messageId && handlersByMessageIdRef.current.get(messageId) === targetHandler) {
      handlersByMessageIdRef.current.delete(messageId);
    }
    if (messageId) {
      queuedAugmentsByMessageIdRef.current.delete(messageId);
      queuedPendingByMessageIdRef.current.delete(messageId);
    }
  }, []);

  const value: StreamingMarkdownContextValue = {
    registerStreamingHandler,
    dispatchAugment,
    dispatchPending,
    dispatchStreamEnd,
  };

  return (
    <StreamingMarkdownContext.Provider value={value}>{children}</StreamingMarkdownContext.Provider>
  );
}

/**
 * 读取流式 markdown context。
 * 不在 Provider 内部时返回 null，让组件优雅降级——
 * 这样未启用流式渲染的页面（如 debug 页的左两栏）也能复用 TextBlock 组件。
 */
export function useStreamingMarkdownContext(): StreamingMarkdownContextValue | null {
  return useContext(StreamingMarkdownContext);
}
