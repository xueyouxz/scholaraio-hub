import { useCallback, useEffect, useRef, useState } from "react";

interface UseSessionStreamOptions {
  onMessage: (data: { eventType: string; [key: string]: unknown }) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export function useSessionStream(sessionId: string | null, options: UseSessionStreamOptions) {
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const close = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!sessionId || sourceRef.current) return;

    const source = new EventSource(`/api/sessions/${sessionId}/stream`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    const forward = (eventType: string, event: MessageEvent<string>) => {
      try {
        const payload = event.data ? JSON.parse(event.data) : {};
        optionsRef.current.onMessage({
          ...(payload as Record<string, unknown>),
          eventType,
        });
      } catch (error) {
        console.warn("[useSessionStream] failed to parse stream event payload", {
          eventType,
          error,
        });
        optionsRef.current.onMessage({ eventType });
      }
    };

    source.addEventListener("connected", (event) => {
      setConnected(true);
      optionsRef.current.onOpen?.();
      forward("connected", event as MessageEvent<string>);
    });
    source.addEventListener("message", (event) =>
      forward("message", event as MessageEvent<string>),
    );
    source.addEventListener("status", (event) => forward("status", event as MessageEvent<string>));
    source.addEventListener("mode-change", (event) =>
      forward("mode-change", event as MessageEvent<string>),
    );
    source.addEventListener("markdown-augment", (event) =>
      forward("markdown-augment", event as MessageEvent<string>),
    );
    source.addEventListener("pending", (event) =>
      forward("pending", event as MessageEvent<string>),
    );
    source.addEventListener("deferred-queue", (event) =>
      forward("deferred-queue", event as MessageEvent<string>),
    );
    source.addEventListener("session-id-changed", (event) =>
      forward("session-id-changed", event as MessageEvent<string>),
    );
    source.addEventListener("complete", (event) => {
      forward("complete", event as MessageEvent<string>);
      close();
    });
    source.addEventListener("heartbeat", () => {
      setConnected(true);
    });
    source.onerror = (event) => {
      close();
      optionsRef.current.onError?.(event);
    };
  }, [close, sessionId]);

  const reconnect = useCallback(() => {
    close();
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, 50);
  }, [close, connect]);

  useEffect(() => {
    connect();
    return close;
  }, [connect, close]);

  return { connected, reconnect };
}
