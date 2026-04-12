import { createContext, useCallback, useContext, useRef } from "react";
import type { AugmentEvent, PendingEvent } from "./useStreamingMarkdown";

interface StreamingHandlers {
  onAugment: (augment: AugmentEvent) => void;
  onPending: (pending: PendingEvent) => void;
  onStreamEnd: () => void;
  captureHtml?: () => string | null;
}

interface StreamingMarkdownContextValue {
  registerStreamingHandler: (handlers: StreamingHandlers) => () => void;
  dispatchAugment: (augment: AugmentEvent) => void;
  dispatchPending: (pending: PendingEvent) => void;
  dispatchStreamEnd: () => void;
  setCurrentMessageId: (messageId: string | null) => void;
  captureStreamingHtml: () => string | null;
}

const StreamingMarkdownContext = createContext<StreamingMarkdownContextValue | null>(null);

export function StreamingMarkdownProvider({ children }: { children: React.ReactNode }) {
  const handlersRef = useRef<StreamingHandlers | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  const registerStreamingHandler = useCallback((handlers: StreamingHandlers) => {
    handlersRef.current = handlers;
    return () => {
      if (handlersRef.current === handlers) {
        handlersRef.current = null;
      }
    };
  }, []);

  const dispatchAugment = useCallback((augment: AugmentEvent) => {
    handlersRef.current?.onAugment(augment);
  }, []);

  const dispatchPending = useCallback((pending: PendingEvent) => {
    handlersRef.current?.onPending(pending);
  }, []);

  const dispatchStreamEnd = useCallback(() => {
    handlersRef.current?.onStreamEnd();
    currentMessageIdRef.current = null;
  }, []);

  const setCurrentMessageId = useCallback((messageId: string | null) => {
    currentMessageIdRef.current = messageId;
  }, []);

  const captureStreamingHtml = useCallback(() => {
    return handlersRef.current?.captureHtml?.() ?? null;
  }, []);

  return (
    <StreamingMarkdownContext.Provider
      value={{
        registerStreamingHandler,
        dispatchAugment,
        dispatchPending,
        dispatchStreamEnd,
        setCurrentMessageId,
        captureStreamingHtml,
      }}
    >
      {children}
    </StreamingMarkdownContext.Provider>
  );
}

export function useStreamingMarkdownContext() {
  return useContext(StreamingMarkdownContext);
}
