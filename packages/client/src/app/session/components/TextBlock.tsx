import { useCallback, useEffect, useState } from "react";
import { useStreamingMarkdownContext } from "../streaming/StreamingMarkdownContext";
import { useStreamingMarkdown } from "../streaming/useStreamingMarkdown";

interface TextBlockProps {
  text: string;
  augmentHtml?: string;
  isStreaming?: boolean;
}

export function TextBlock({ text, augmentHtml, isStreaming = false }: TextBlockProps) {
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

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard failures can be ignored here.
    }
  }, [text]);

  const showStreamingContent = isStreaming && useStreamingContent;

  return (
    <div className={`session-text-block${isStreaming ? " is-streaming" : ""}`}>
      <button
        type="button"
        className={`session-text-copy${copied ? " is-copied" : ""}`}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {isStreaming ? (
        <div
          className="session-streaming-frame"
          style={showStreamingContent ? undefined : { display: "none" }}
        >
          <div ref={streamingMarkdown.containerRef} className="streaming-blocks" />
          <span ref={streamingMarkdown.pendingRef} className="streaming-pending" />
        </div>
      ) : null}
      {!showStreamingContent &&
        (augmentHtml ? (
          <div
            className="markdown-html"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered markdown HTML
            dangerouslySetInnerHTML={{ __html: augmentHtml }}
          />
        ) : (
          <p>{text}</p>
        ))}
    </div>
  );
}
