import { useCallback, useRef, useState } from "react";

export interface AugmentEvent {
  blockIndex: number;
  html: string;
  type: string;
  messageId?: string;
}

export interface PendingEvent {
  html: string;
}

export interface StreamingMarkdownState {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pendingRef: React.RefObject<HTMLSpanElement | null>;
  isStreaming: boolean;
  onAugment: (augment: AugmentEvent) => void;
  onPending: (pending: PendingEvent) => void;
  onStreamEnd: () => void;
  reset: () => void;
  captureHtml: () => string | null;
}

export function useStreamingMarkdown(): StreamingMarkdownState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<HTMLSpanElement | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const blocksRef = useRef<Map<number, HTMLElement>>(new Map());
  const maxBlockIndexRef = useRef(-1);

  const onAugment = useCallback((augment: AugmentEvent) => {
    const container = containerRef.current;
    if (!container) return;

    setIsStreaming(true);

    if (blocksRef.current.has(augment.blockIndex)) {
      const existing = blocksRef.current.get(augment.blockIndex);
      if (existing) {
        existing.innerHTML = augment.html;
      }
      return;
    }

    const block = document.createElement("div");
    block.className = "streaming-block";
    block.dataset.blockIndex = String(augment.blockIndex);
    block.innerHTML = augment.html;

    if (augment.blockIndex > maxBlockIndexRef.current) {
      container.appendChild(block);
      maxBlockIndexRef.current = augment.blockIndex;
    } else {
      let inserted = false;
      for (const child of Array.from(container.children)) {
        const childIndex = Number.parseInt((child as HTMLElement).dataset.blockIndex ?? "-1", 10);
        if (childIndex > augment.blockIndex) {
          container.insertBefore(block, child);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        container.appendChild(block);
      }
    }

    blocksRef.current.set(augment.blockIndex, block);
  }, []);

  const onPending = useCallback((pending: PendingEvent) => {
    if (!pendingRef.current) return;
    setIsStreaming(true);
    pendingRef.current.innerHTML = pending.html;
  }, []);

  const onStreamEnd = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.innerHTML = "";
    }
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
    if (pendingRef.current) {
      pendingRef.current.innerHTML = "";
    }
    blocksRef.current.clear();
    maxBlockIndexRef.current = -1;
    setIsStreaming(false);
  }, []);

  const captureHtml = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const pending = pendingRef.current?.innerHTML ?? "";
    return `${container.innerHTML}${pending}`;
  }, []);

  return {
    containerRef,
    pendingRef,
    isStreaming,
    onAugment,
    onPending,
    onStreamEnd,
    reset,
    captureHtml,
  };
}
