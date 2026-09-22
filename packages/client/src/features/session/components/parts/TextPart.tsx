import { memo, useEffect, useState } from "react";
import { Markdown } from "../../../../shared/components/Markdown";

// Memoized on its string props: without this, every streamed delta re-parses
// the markdown of every finished block in the turn.
export const TextPart = memo(function TextPart({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (error) {
      console.error("复制失败", error);
    }
  };
  return (
    <div className="text-block timeline-item">
      <button
        type="button"
        className={`text-block-copy ${copied ? "copied" : ""}`}
        onClick={() => void copy()}
        title={copied ? "已复制" : "复制 Markdown"}
        aria-label={copied ? "已复制" : "复制 Markdown"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <Markdown text={text} streaming={streaming} className="session-markdown" />
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
