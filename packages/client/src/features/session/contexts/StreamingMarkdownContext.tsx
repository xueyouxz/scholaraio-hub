import { type ReactNode, createContext, useCallback, useContext, useRef } from "react";
import type { AugmentEvent, PendingEvent } from "../hooks/useStreamingMarkdown";

/**
 * 当前正在流式输出的 TextBlock 向本 Context 注册的回调集合。
 * 任意时刻只允许一个 TextBlock 注册（最新的 streaming 文本块），
 * 旧 handler 在新流开始时会被自动覆盖。
 */
interface StreamingHandlers {
  /** 完整 markdown block 闭合时触发（如代码块、段落、表格） */
  onAugment: (augment: AugmentEvent) => void;
  /** 未闭合的尾巴文本，每个 text delta 都会触发一次 */
  onPending: (pending: PendingEvent) => void;
  /** 流结束信号，TextBlock 据此把 pending 清掉 */
  onStreamEnd: () => void;
  /** 抓取当前 streaming 容器里已渲染好的 HTML 字符串。
   *  用于流结束时把这段 HTML "固化" 到最终消息，避免重渲染时闪一下 */
  captureHtml?: () => string | null;
}

/**
 * 流式 markdown 事件总线的 Context value。
 *
 * 设计动机：SSE 来的 augment/pending 事件需要送达 "正在流式的 TextBlock"，
 * 但 TextBlock 是嵌在 MessageList → RenderItem → ContentBlockRenderer 多层之下的，
 * 用 props 透传会污染所有中间层。所以用 Context 做"单注册位事件总线"：
 *   - dispatch* 由 useSession 在收到 SSE 事件时调用（事件源）
 *   - registerStreamingHandler 由当前流式 TextBlock 在 mount 时调用（订阅方）
 * 任意时刻只有一个 TextBlock 处于流式态，刚好一对一。
 */
interface StreamingMarkdownContextValue {
  /**
   * 把当前 TextBlock 注册为流式接收方。
   * 同一时间只能有一个 handler 生效——后注册的会覆盖前一个。
   * 返回 unregister 函数；该函数只有在 "当前 handler 仍是自己" 时才清掉，
   * 避免 React 严格模式下 cleanup 顺序与 mount 顺序错乱导致误清。
   */
  registerStreamingHandler: (handlers: StreamingHandlers) => () => void;

  /** 向当前注册 handler 派发一个已闭合的 markdown 块（augment 事件） */
  dispatchAugment: (augment: AugmentEvent) => void;

  /** 向当前注册 handler 派发一段还在打字的 inline HTML（pending 事件） */
  dispatchPending: (pending: PendingEvent) => void;

  /** 通知流已结束 */
  dispatchStreamEnd: () => void;

  /**
   * 设置当前流式消息 ID。
   * 在 stream_event 的 message_start 到达时调用，仅用于调试与跟踪，
   * 不参与派发路由（路由靠 registerStreamingHandler 的单注册位实现）。
   */
  setCurrentMessageId: (messageId: string | null) => void;

  /**
   * 从当前注册 handler 抓取已渲染的 HTML。
   * 用于流结束瞬间把临时占位的 streaming HTML "固化"到正式消息上，
   * 否则会先看到一段 streaming HTML，再被 React 重新渲染替换成最终 HTML，
   * 产生短暂闪烁。
   */
  captureStreamingHtml: () => string | null;
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
  // 当前唯一注册的流式 handler（同一时刻只有一个 TextBlock 处于流式态）
  const handlersRef = useRef<StreamingHandlers | null>(null);

  // 当前流式消息 ID，仅用于调试输出，不参与路由决策
  const currentMessageIdRef = useRef<string | null>(null);

  const registerStreamingHandler = useCallback((handlers: StreamingHandlers): (() => void) => {
    if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
      console.log("%c[CONTEXT] Handler registered", "color: #2196F3", {
        hadPreviousHandler: !!handlersRef.current,
      });
    }
    handlersRef.current = handlers;
    return () => {
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
  }, []);

  const setCurrentMessageId = useCallback((messageId: string | null) => {
    currentMessageIdRef.current = messageId;
  }, []);

  const dispatchAugment = useCallback((augment: AugmentEvent) => {
    if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
      console.log("%c[CONTEXT] dispatchAugment called", "color: #4CAF50", {
        hasHandler: !!handlersRef.current,
        augment: { blockIndex: augment.blockIndex, type: augment.type },
      });
    }
    // 没注册 handler 时静默丢弃（比如初始加载阶段、或两个流交替的瞬间）
    // 不需要缓冲，因为 augment 本身只是优化加速；丢了也只是退化为流结束后整体渲染
    handlersRef.current?.onAugment(augment);
  }, []);

  const dispatchPending = useCallback((pending: PendingEvent) => {
    if (typeof window !== "undefined" && window.__STREAMING_DEBUG__) {
      console.log("%c[CONTEXT] dispatchPending called", "color: #FF9800", {
        hasHandler: !!handlersRef.current,
        htmlLength: pending.html.length,
      });
    }
    // 同样静默丢弃；pending 是打字预览，丢一帧无关紧要
    handlersRef.current?.onPending(pending);
  }, []);

  const dispatchStreamEnd = useCallback(() => {
    handlersRef.current?.onStreamEnd();
    // 流结束后清掉 currentMessageId，避免下一条消息复用旧 ID
    currentMessageIdRef.current = null;
  }, []);

  const captureStreamingHtml = useCallback((): string | null => {
    return handlersRef.current?.captureHtml?.() ?? null;
  }, []);

  const value: StreamingMarkdownContextValue = {
    registerStreamingHandler,
    setCurrentMessageId,
    dispatchAugment,
    dispatchPending,
    dispatchStreamEnd,
    captureStreamingHtml,
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
