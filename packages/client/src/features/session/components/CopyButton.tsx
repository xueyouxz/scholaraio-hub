import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/** Copy text to the clipboard; the icon confirms for two seconds. */
export function CopyButton({ text, label }: { text: string; label: string }) {
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
    <button
      type="button"
      className={`message-action${copied ? " done" : ""}`}
      onClick={() => void copy()}
      title={copied ? "已复制" : label}
      aria-label={copied ? "已复制" : label}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}
