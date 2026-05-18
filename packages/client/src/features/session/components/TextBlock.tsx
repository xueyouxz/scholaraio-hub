import { memo, useCallback, useEffect, useState } from "react";
import { useStreamingMarkdownContext } from "../streaming/StreamingMarkdownContext";
import { useStreamingMarkdown } from "../streaming/useStreamingMarkdown";
import { LocalMediaModal, useLocalMediaClick } from "./LocalMediaModal";

interface Props {
  text: string;
  isStreaming?: boolean;
  /** 服务端预渲染的 HTML，通常用于已完成的 assistant markdown 消息。 */
  augmentHtml?: string;
}

export const TextBlock = memo(function TextBlock({
  text,
  isStreaming = false,
  augmentHtml,
}: Props) {
  const [copied, setCopied] = useState(false);

  const streamingMarkdown = useStreamingMarkdown();
  const streamingContext = useStreamingMarkdownContext();

  const [useStreamingContent, setUseStreamingContent] = useState(false);

  // 流式消息渲染时，把当前 TextBlock 注册到 StreamingMarkdownContext。
  // 这样上层收到 markdown-augment/pending 事件时，可以把 HTML 分发到当前文本块。
  useEffect(() => {
    if (!isStreaming || !streamingContext) {
      // 不再流式输出时重置本地流式状态。
      // 完整 HTML 会在组件重新挂载前被捕获到 markdownAugments，因此这里可以安全 reset。
      if (!isStreaming) {
        setUseStreamingContent(false);
        streamingMarkdown.reset();
      }
      return;
    }

    // 向 context 注册当前文本块的处理函数。返回的 unregister 会在组件卸载或依赖变化时执行。
    const unregister = streamingContext.registerStreamingHandler({
      onAugment: (augment) => {
        // 第一次收到 augment 后，切换到流式 HTML 容器显示。
        setUseStreamingContent(true);
        streamingMarkdown.onAugment(augment);
      },
      onPending: streamingMarkdown.onPending,
      onStreamEnd: streamingMarkdown.onStreamEnd,
      captureHtml: streamingMarkdown.captureHtml,
    });

    return unregister;
  }, [isStreaming, streamingContext, streamingMarkdown]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [text]);

  const { modal, handleClick, closeModal } = useLocalMediaClick();

  const showStreamingContent = isStreaming && useStreamingContent;

  // 只要处于 streaming，就提前渲染 streaming 容器，让 ref 在第一条 augment 到达前就准备好。
  // 在真正收到 augment 之前容器保持隐藏，避免空白内容闪烁。
  const renderStreamingContainer = isStreaming;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 点击处理只拦截本地媒体链接，不作为按钮交互
    <div
      className={`text-block timeline-item${isStreaming ? " streaming" : ""}`}
      onClick={handleClick}
    >
      <button
        type="button"
        className={`text-block-copy${copied ? " copied" : ""}`}
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy markdown"}
        aria-label={copied ? "Copied!" : "Copy markdown"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>

      {/* 流式输出时始终挂载 DOM 节点，确保服务端 HTML 片段到达时 ref 已可用。 */}
      {renderStreamingContainer && (
        <div style={showStreamingContent ? undefined : { display: "none" }}>
          <div ref={streamingMarkdown.containerRef} className="streaming-blocks" />
          <span ref={streamingMarkdown.pendingRef} className="streaming-pending" />
        </div>
      )}

      {/* 未使用流式 HTML 时显示兜底内容：优先服务端完整 HTML，其次纯文本。 */}
      {!showStreamingContent &&
        (augmentHtml ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML 来自服务端 markdown 渲染结果
          <div dangerouslySetInnerHTML={{ __html: augmentHtml }} />
        ) : (
          // 没有服务端 HTML 时退回纯文本，保证消息至少可读。
          <p>{text}</p>
        ))}
      {modal && (
        <LocalMediaModal path={modal.path} mediaType={modal.mediaType} onClose={closeModal} />
      )}
    </div>
  );
});

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  );
}
