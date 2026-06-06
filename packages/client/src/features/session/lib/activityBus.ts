import type {
  AgentActivity,
  ContextUsage,
  PendingInputType,
  UrlProjectId,
} from "@scholaraio-hub/shared";
import type { SessionStatus, SessionSummary } from "../types";

declare global {
  interface Window {
    __ACTIVITY_DEBUG__?: boolean;
  }
}

export type FileChangeType = "create" | "modify" | "delete";
export type FileType =
  | "session"
  | "agent-session"
  | "settings"
  | "credentials"
  | "telemetry"
  | "other";

export interface FileChangeEvent {
  type: "file-change";
  provider: "claude" | "gemini" | "codex";
  path: string;
  relativePath: string;
  changeType: FileChangeType;
  timestamp: string;
  fileType: FileType;
}

export interface SessionStatusEvent {
  type: "session-status-changed";
  sessionId: string;
  projectId: UrlProjectId;
  ownership: SessionStatus;
  timestamp: string;
}

export interface SessionCreatedEvent {
  type: "session-created";
  session: SessionSummary;
  timestamp: string;
}

export interface SessionSeenEvent {
  type: "session-seen";
  sessionId: string;
  timestamp: string;
  messageId?: string;
}

export interface ProcessStateEvent {
  type: "process-state-changed";
  sessionId: string;
  projectId: UrlProjectId;
  activity: AgentActivity;
  pendingInputType?: PendingInputType;
  timestamp: string;
}

export interface SessionMetadataChangedEvent {
  type: "session-metadata-changed";
  sessionId: string;
  title?: string;
  archived?: boolean;
  starred?: boolean;
  timestamp: string;
}

export interface SessionUpdatedEvent {
  type: "session-updated";
  sessionId: string;
  projectId: UrlProjectId;
  title?: string | null;
  messageCount?: number;
  updatedAt?: string;
  contextUsage?: ContextUsage;
  model?: string;
  timestamp: string;
}

export interface SourceChangeEvent {
  type: "source-change";
  target: "backend" | "frontend";
  files: string[];
  timestamp: string;
}

export interface WorkerActivityEvent {
  type: "worker-activity-changed";
  activeWorkers: number;
  queueLength: number;
  hasActiveWork: boolean;
  timestamp: string;
}

interface ActivityEventMap {
  "file-change": FileChangeEvent;
  "session-status-changed": SessionStatusEvent;
  "session-created": SessionCreatedEvent;
  "session-updated": SessionUpdatedEvent;
  "session-seen": SessionSeenEvent;
  "process-state-changed": ProcessStateEvent;
  "session-metadata-changed": SessionMetadataChangedEvent;
  "source-change": SourceChangeEvent;
  "backend-reloaded": undefined;
  "worker-activity-changed": WorkerActivityEvent;
  reconnect: undefined;
  refresh: undefined;
}

export type ActivityEventType = keyof ActivityEventMap;
type Listener<T> = (data: T) => void;

let activityDebugStorageWarningLogged = false;

function isActivityDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__ACTIVITY_DEBUG__ === true) return true;
  try {
    return localStorage.getItem("scholaraio-activity-debug") === "true";
  } catch (error) {
    if (!activityDebugStorageWarningLogged) {
      console.warn("[activityBus] failed to read debug flag from localStorage", error);
      activityDebugStorageWarningLogged = true;
    }
    return false;
  }
}

export class ActivityBus {
  private source: EventSource | null = null;
  private listeners = new Map<ActivityEventType, Set<Listener<unknown>>>();
  private hasConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sourceListenerCleanups: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;
  private _connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Subscribe to connection-state transitions. Fires only when the value
   * actually changes, replacing per-consumer polling of `connected`. Returns an
   * unsubscribe function.
   */
  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return;
    this._connected = value;
    for (const listener of this.connectionListeners) {
      listener(value);
    }
  }

  connect(): void {
    if (this.source || typeof window === "undefined") return;

    const debug = isActivityDebugEnabled();
    const source = new EventSource("/api/activity/stream", { withCredentials: true });
    this.source = source;

    const handleConnected = () => {
      this.setConnected(true);
      if (this.hasConnected) {
        this.emit("reconnect", undefined);
      }
      this.hasConnected = true;
    };

    const handleTypedEvent = <K extends ActivityEventType>(eventType: K, event: MessageEvent) => {
      try {
        const payload = event.data ? JSON.parse(event.data) : undefined;
        if (debug) console.log("[ActivityBus] event", eventType, payload);
        this.emit(eventType, payload as ActivityEventMap[K]);
      } catch (err) {
        if (debug) console.warn("[ActivityBus] failed to parse event", eventType, err);
      }
    };

    const addSourceListener = (
      eventType: string,
      listener: (event: MessageEvent<string>) => void,
    ) => {
      const eventListener: EventListener = (event) => listener(event as MessageEvent<string>);
      source.addEventListener(eventType, eventListener);
      this.sourceListenerCleanups.push(() => source.removeEventListener(eventType, eventListener));
    };

    addSourceListener("connected", handleConnected);
    addSourceListener("file-change", (event) => handleTypedEvent("file-change", event));
    addSourceListener("session-status-changed", (event) =>
      handleTypedEvent("session-status-changed", event),
    );
    addSourceListener("session-created", (event) => handleTypedEvent("session-created", event));
    addSourceListener("session-updated", (event) => handleTypedEvent("session-updated", event));
    addSourceListener("session-seen", (event) => handleTypedEvent("session-seen", event));
    addSourceListener("process-state-changed", (event) =>
      handleTypedEvent("process-state-changed", event),
    );
    addSourceListener("session-metadata-changed", (event) =>
      handleTypedEvent("session-metadata-changed", event),
    );
    addSourceListener("source-change", (event) => handleTypedEvent("source-change", event));
    addSourceListener("backend-reloaded", () => this.emit("backend-reloaded", undefined));
    addSourceListener("worker-activity-changed", (event) =>
      handleTypedEvent("worker-activity-changed", event),
    );
    addSourceListener("heartbeat", () => {
      this.setConnected(true);
    });

    source.onerror = () => {
      this.setConnected(false);
      this.closeSource();
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1000);
    };

    this.ensureVisibilityListener();
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSource();
    this.removeVisibilityListener();
    this.hasConnected = false;
    this.setConnected(false);
  }

  on<K extends ActivityEventType>(
    eventType: K,
    callback: Listener<ActivityEventMap[K]>,
  ): () => void {
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(callback as Listener<unknown>);

    return () => {
      set.delete(callback as Listener<unknown>);
    };
  }

  private emit<K extends ActivityEventType>(eventType: K, data: ActivityEventMap[K]): void {
    const set = this.listeners.get(eventType);
    if (!set) return;
    for (const listener of set) {
      listener(data);
    }
  }

  private ensureVisibilityListener(): void {
    if (this.visibilityHandler || typeof document === "undefined") return;

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible" && this._connected) {
        this.emit("refresh", undefined);
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private removeVisibilityListener(): void {
    if (!this.visibilityHandler || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.visibilityHandler = null;
  }

  private closeSource(): void {
    for (const cleanup of this.sourceListenerCleanups.splice(0)) {
      cleanup();
    }
    if (this.source) {
      this.source.onerror = null;
      this.source.close();
      this.source = null;
    }
  }
}

export const activityBus = new ActivityBus();
