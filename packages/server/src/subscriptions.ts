/**
 * 会话流和活动流共用的订阅处理器。
 *
 * SSE 流路由（streams.ts）会调用这里的工厂函数，并传入各自的 `emit`
 * 实现。这样订阅逻辑只负责把内部事件转换成外部事件，具体传输
 * 方式则由调用方决定（当前为 SSE，工厂本身与传输无关）。
 */

import { SESSION_STREAM_EVENT } from "@scholaraio-hub/shared";
import { type StreamAugmenter, createStreamAugmenter, markSubagent } from "./augments/index.js";
import { getLogger } from "./logging/logger.js";
import type { Process } from "./supervisor/Process.js";
import type { ProcessEvent } from "./supervisor/types.js";
import type { BusEvent, EventBus } from "./watcher/index.js";

export type Emit = (eventType: string, data: unknown) => void;

export interface SubscriptionOptions {
  /** 内部处理失败时调用，例如 Markdown 增强、消息追赶或事件转发失败。 */
  onError?: (err: unknown) => void;
  /** 可选的调试日志标签，通常用于写入订阅 id，方便排查具体连接。 */
  logLabel?: string;
}

/**
 * 创建会话订阅，并把 Process 产生的内部事件通过 `emit` 转发给外部连接。
 *
 * 订阅建立后会按顺序发送：
 * 1. 当前连接状态和会话元信息；
 * 2. 已缓存的历史消息，供晚加入的客户端补齐上下文；
 * 3. 当前仍在流式输出的文本对应的 pending HTML。
 *
 * 为了避免竞态，本函数会先订阅 Process 事件，再读取状态并发送
 * "connected" 事件。这样状态变化要么已经进入快照，要么会被新的
 * 订阅回调收到，不会落在两者之间而丢失。
 */
export function createSessionSubscription(
  process: Process,
  emit: Emit,
  options?: SubscriptionOptions,
): { cleanup: () => void } {
  let completed = false;

  // 懒加载 stream augmenter：只有真正收到消息或需要补发 pending HTML 时才创建。
  // 这样空连接只承担心跳和状态转发成本。augmenterPromise 用来合并并发初始化，
  // 避免同一个订阅在短时间内创建多个 augmenter 实例。
  let augmenter: StreamAugmenter | null = null;
  let augmenterPromise: Promise<StreamAugmenter> | null = null;

  const getAugmenter = async (): Promise<StreamAugmenter> => {
    if (augmenter) return augmenter;
    if (!augmenterPromise) {
      augmenterPromise = createStreamAugmenter({
        onMarkdownAugment: (data) => {
          if (!completed) emit(SESSION_STREAM_EVENT.markdownAugment, data);
        },
        onPending: (data) => {
          if (!completed) emit(SESSION_STREAM_EVENT.pending, data);
        },
        onError: (err, context) => {
          options?.onError?.(err);
          console.warn(`[subscription] ${context}:`, err);
        },
      });
    }
    augmenter = await augmenterPromise;
    return augmenter;
  };

  // 心跳用于让客户端和中间代理知道连接仍然存活。
  // 释放路径：会话完成和 cleanup() 都会 clearInterval；如果 emit 抛错，
  // 说明传输层很可能已经断开，也立即停止心跳，避免泄漏定时器。
  const heartbeatInterval = setInterval(() => {
    try {
      if (!completed) {
        emit(SESSION_STREAM_EVENT.heartbeat, { timestamp: new Date().toISOString() });
      }
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 30_000);

  // 关键时序：必须先订阅，再读取当前状态。
  // 因此任意状态变化都保证满足以下二者之一：
  // 1. 如果变化发生在状态快照之前，会被下面的 currentState 捕获；
  // 2. 如果变化发生在订阅之后，会被当前 subscriber 收到并转发。
  // 这个顺序消除了“读取快照”和“开始监听”之间的丢事件窗口。
  const unsubscribe = process.subscribe(async (event: ProcessEvent) => {
    if (completed) return;

    try {
      switch (event.type) {
        case "message": {
          // Provider field normalization happens at ingestion (Process), so the
          // message here is already in canonical shape for augmentation + emit.
          const message = event.message as Record<string, unknown>;
          const aug = await getAugmenter();
          await aug.processMessage(message);
          emit(SESSION_STREAM_EVENT.message, markSubagent(message));
          break;
        }

        case "state-change":
          emit(SESSION_STREAM_EVENT.status, {
            state: event.state.type,
            ...(event.state.type === "waiting-input" ? { request: event.state.request } : {}),
          });
          break;

        case "mode-change":
          emit(SESSION_STREAM_EVENT.modeChange, {
            permissionMode: event.mode,
            modeVersion: event.version,
          });
          break;

        case "error":
          emit(SESSION_STREAM_EVENT.error, { message: event.error.message });
          break;

        case "session-id-changed":
          emit(SESSION_STREAM_EVENT.sessionIdChanged, {
            oldSessionId: event.oldSessionId,
            newSessionId: event.newSessionId,
          });
          break;

        case "deferred-queue":
          emit(SESSION_STREAM_EVENT.deferredQueue, { messages: event.messages });
          break;

        case "complete":
          if (augmenter) {
            await augmenter.flush();
          }
          emit(SESSION_STREAM_EVENT.complete, { timestamp: new Date().toISOString() });
          completed = true;
          clearInterval(heartbeatInterval);
          break;
      }
    } catch (err) {
      options?.onError?.(err);
    }
  });

  // 现在订阅已经挂上，可以安全读取当前状态并发送 "connected"。
  // 这条事件是客户端初始化视图的基线：包含会话 id、权限模式、provider、
  // resolved model、等待输入请求，以及尚未发送的 deferred queue 摘要。
  const currentState = process.state;
  const deferredMessages = process.getDeferredQueueSummary();
  emit(SESSION_STREAM_EVENT.connected, {
    processId: process.id,
    sessionId: process.sessionId,
    state: currentState.type,
    permissionMode: process.permissionMode,
    modeVersion: process.modeVersion,
    provider: process.provider,
    model: process.resolvedModel,
    ...(currentState.type === "waiting-input" ? { request: currentState.request } : {}),
    ...(deferredMessages.length > 0 ? { deferredMessages } : {}),
  });

  // 给晚加入的客户端回放已缓存消息。
  // isReplay 标记让前端能够区分历史消息和实时消息，避免把回放内容当作新输出处理。
  for (const message of process.getMessageHistory()) {
    emit(
      SESSION_STREAM_EVENT.message,
      markSubagent({
        ...message,
        isReplay: true,
      }),
    );
  }

  // 追赶当前仍在流式生成的文本。
  // 历史消息只覆盖已经落入 message history 的内容；如果模型仍在输出，
  // 这里会把累积的 streaming text 交给 augmenter 生成 pending HTML，
  // 让新连接的客户端可以立即看到正在增长的答案片段。
  const streamingContent = process.getStreamingContent();
  if (streamingContent) {
    getAugmenter()
      .then(async (aug) => {
        await aug.processCatchUp(streamingContent.text, streamingContent.messageId);
      })
      .catch((err) => {
        console.warn("[subscription] Failed to send catch-up pending HTML:", err);
      });
  }

  return {
    cleanup: () => {
      // 订阅释放路径：停止接收后续回调、清理心跳定时器，并解除 Process 订阅。
      // completed 会让已经排队的异步 augmenter 回调在 emit 前自行退出。
      completed = true;
      clearInterval(heartbeatInterval);
      unsubscribe();
    },
  };
}

/**
 * 创建活动订阅，并把 EventBus 上的活动事件通过 `emit` 转发给外部连接。
 *
 * 与会话订阅相比，活动订阅没有消息回放或 Markdown 增强，只负责实时转发
 * watcher/event bus 事件。调用方必须在连接关闭时调用 cleanup()，
 * 否则 EventBus 订阅和心跳定时器会继续存在。
 */
export function createActivitySubscription(
  eventBus: EventBus,
  emit: Emit,
  options?: SubscriptionOptions,
): { cleanup: () => void } {
  let closed = false;

  // 先发送 connected，让客户端能确认活动流已经建立，即使之后暂时没有事件。
  emit("connected", { timestamp: new Date().toISOString() });

  // 活动流同样发送心跳。释放路径与会话订阅一致：
  // cleanup()、emit 抛错都会停止定时器，避免断开的连接继续占用资源。
  const heartbeatInterval = setInterval(() => {
    try {
      if (!closed) {
        emit("heartbeat", { timestamp: new Date().toISOString() });
      }
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 30_000);

  const unsubscribe = eventBus.subscribe((event: BusEvent) => {
    if (closed) return;
    try {
      const label = options?.logLabel ? ` sub=${options.logLabel}` : "";
      getLogger().debug(`[ActivitySubscription] Forwarding event type=${event.type}${label}`);
      emit(event.type, event);
    } catch (err) {
      options?.onError?.(err);
    }
  });

  return {
    cleanup: () => {
      // 订阅释放路径：标记关闭、防止后续事件继续 emit，清理心跳并解除 EventBus 订阅。
      closed = true;
      clearInterval(heartbeatInterval);
      unsubscribe();
    },
  };
}
