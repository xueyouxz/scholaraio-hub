import { memo, useCallback, useEffect, useState } from "react";
import { useStreamingMarkdownContext } from "../../contexts/StreamingMarkdownContext";
import { useStreamingMarkdown } from "../../hooks/useStreamingMarkdown";
import { LocalMediaModal, useLocalMediaClick } from "../LocalMediaModal";

interface Props {
  text: string;
  isStreaming?: boolean;
  streamingMessageId?: string;
  /** Pre-rendered HTML from server (for completed messages) */
  augmentHtml?: string;
}

export const TextBlock = memo(function TextBlock({
  text,
  isStreaming = false,
  streamingMessageId,
  augmentHtml,
}: Props) {
  const [copied, setCopied] = useState(false);

  // Streaming markdown hook for server-rendered content
  const { containerRef, pendingRef, onAugment, onPending, onStreamEnd, reset } =
    useStreamingMarkdown();
  const streamingContext = useStreamingMarkdownContext();

  // Track whether we're actively using streaming markdown (received augment or pending HTML)
  const [useStreamingContent, setUseStreamingContent] = useState(false);

  // Register with context when streaming and context is available
  useEffect(() => {
    if (!isStreaming || !streamingContext) {
      // Reset streaming state when not streaming
      if (!isStreaming) {
        setUseStreamingContent(false);
        reset();
      }
      return;
    }

    // Register handlers with the context
    const unregister = streamingContext.registerStreamingHandler(
      {
        onAugment: (augment) => {
          setUseStreamingContent(true);
          onAugment(augment);
        },
        onPending: (pending) => {
          setUseStreamingContent(true);
          onPending(pending);
        },
        onStreamEnd,
      },
      streamingMessageId,
    );

    return unregister;
  }, [isStreaming, streamingContext, streamingMessageId, onAugment, onPending, onStreamEnd, reset]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  }, [text]);

  const { modal, handleClick, closeModal } = useLocalMediaClick();

  const showStreamingContent = isStreaming && useStreamingContent;

  // Always render streaming container when isStreaming so refs are attached
  // before first augment arrives. Hidden until useStreamingContent becomes true.
  const renderStreamingContainer = isStreaming;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: click handler intercepts local media links only
    <div
      className={`text-block timeline-item${isStreaming ? " streaming" : ""}`}
      onClick={handleClick}
    >
      <button
        type="button"
        className={`text-block-copy ${copied ? "copied" : ""}`}
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy markdown"}
        aria-label={copied ? "Copied!" : "Copy markdown"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>

      {/* Always render streaming elements when streaming so refs are ready for augments */}
      {renderStreamingContainer && (
        <div style={showStreamingContent ? undefined : { display: "none" }}>
          <div ref={containerRef} className="streaming-blocks" />
          <span ref={pendingRef} className="streaming-pending" />
        </div>
      )}

      {/* Show fallback content when not actively streaming */}
      {!showStreamingContent &&
        (augmentHtml ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered HTML
          <div dangerouslySetInnerHTML={{ __html: augmentHtml }} />
        ) : (
          // Plain text fallback (no server augment available)
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
