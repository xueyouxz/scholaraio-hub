import { memo, useCallback, useEffect, useState } from "react";
import { useStreamingMarkdownContext } from "../streaming/StreamingMarkdownContext";
import { useStreamingMarkdown } from "../streaming/useStreamingMarkdown";

interface TextBlockProps {
  text: string;
  augmentHtml?: string;
  isStreaming?: boolean;
  timelineItem?: boolean;
}

export const TextBlock = memo(function TextBlock({
  text,
  augmentHtml,
  isStreaming = false,
  timelineItem = false,
}: TextBlockProps) {
  const [copied, setCopied] = useState(false);
  const [useStreamingContent, setUseStreamingContent] = useState(false);
  const streamingMarkdown = useStreamingMarkdown();
  const streamingContext = useStreamingMarkdownContext();

  useEffect(() => {
    if (!isStreaming || !streamingContext) {
      if (!isStreaming) {
        setUseStreamingContent(false);
        streamingMarkdown.reset();
      }
      return;
    }

    const unregister = streamingContext.registerStreamingHandler({
      onAugment: (augment) => {
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
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard failures are ignored.
    }
  }, [text]);

  const showStreamingContent = isStreaming && useStreamingContent;
  const className = `text-block${timelineItem ? " timeline-item" : ""}${isStreaming ? " streaming" : ""}`;

  return (
    <div className={className}>
      {isStreaming ? (
        <div style={showStreamingContent ? undefined : { display: "none" }}>
          <div ref={streamingMarkdown.containerRef} className="streaming-blocks" />
          <span ref={streamingMarkdown.pendingRef} className="streaming-pending" />
        </div>
      ) : null}

      {!showStreamingContent &&
        (augmentHtml ? (
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered markdown HTML
            dangerouslySetInnerHTML={{ __html: augmentHtml }}
          />
        ) : (
          <p>{text}</p>
        ))}

      {!isStreaming ? (
        <div className="text-block-actions">
          <button
            type="button"
            className={`text-block-copy${copied ? " copied" : ""}`}
            onClick={() => void handleCopy()}
            aria-label={copied ? "Copied" : "Copy markdown"}
          >
            {copied ? "✓" : "⧉"}
          </button>
        </div>
      ) : null}
    </div>
  );
});
