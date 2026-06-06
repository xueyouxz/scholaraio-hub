import { useEffect, useRef, useState } from "react";
import { activityBus } from "../lib/activityBus";
import { extractSessionIdFromFileEvent } from "../lib/sessionFile";

export interface SessionWatchTarget {
  sessionId: string;
  projectId: string;
  provider?: string;
}

interface UseSessionWatchStreamOptions {
  onChange: () => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export function useSessionWatchStream(
  target: SessionWatchTarget | null,
  options: UseSessionWatchStreamOptions,
) {
  const [connected, setConnected] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const targetSessionId = target?.sessionId;
  const targetProjectId = target?.projectId;
  const targetProvider = target?.provider;

  useEffect(() => {
    if (!targetSessionId || !targetProjectId) {
      setConnected(false);
      return;
    }

    activityBus.connect();
    setConnected(activityBus.connected);
    optionsRef.current.onOpen?.();

    const unsubscribers = [
      activityBus.onConnectionChange(setConnected),
      activityBus.on("session-updated", (event) => {
        if (event.sessionId === targetSessionId && event.projectId === targetProjectId) {
          optionsRef.current.onChange();
        }
      }),
      activityBus.on("file-change", (event) => {
        if (event.fileType !== "session" && event.fileType !== "agent-session") return;
        if (targetProvider && event.provider !== targetProvider) return;
        if (extractSessionIdFromFileEvent(event) !== targetSessionId) return;
        optionsRef.current.onChange();
      }),
      activityBus.on("reconnect", () => {
        setConnected(true);
        optionsRef.current.onChange();
      }),
      activityBus.on("refresh", () => {
        optionsRef.current.onChange();
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [targetProjectId, targetProvider, targetSessionId]);

  return { connected };
}
