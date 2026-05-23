import { useCallback, useEffect, useRef, useState } from "react";

interface UseSessionStreamOptions {
  onMessage: (data: { eventType: string; [key: string]: unknown }) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

// Auto-reconnect backoff: 1s, 2s, 4s, max 30s.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export function useSessionStream(sessionId: string | null, options: UseSessionStreamOptions) {
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionallyClosedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const close = useCallback(() => {
    intentionallyClosedRef.current = true;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
  }, []);

  // Internal: tear down current source without marking as intentional close.
  // Used by onerror so the auto-reconnect path can fire.
  const teardownForReconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!sessionId || sourceRef.current) return;
    intentionallyClosedRef.current = false;

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
      reconnectAttemptsRef.current = 0;
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
      // EventSource fires "error" both for transient network blips (state CONNECTING/CLOSED)
      // and for unrecoverable failures. We tear down our source and schedule a backoff
      // reconnect — the browser's automatic reconnect is unreliable across providers and
      // doesn't surface connection state to our React tree.
      teardownForReconnect();
      optionsRef.current.onError?.(event);
      if (intentionallyClosedRef.current || !sessionId) return;
      const attempt = reconnectAttemptsRef.current;
      reconnectAttemptsRef.current = attempt + 1;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
  }, [sessionId, teardownForReconnect, close]);

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
