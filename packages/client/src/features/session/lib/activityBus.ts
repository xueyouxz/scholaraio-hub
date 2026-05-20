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

export interface BrowserTabConnectedEvent {
  type: "browser-tab-connected";
  browserProfileId: string;
  connectionId: number;
  transport: "ws";
  tabCount: number;
  totalTabCount: number;
  timestamp: string;
}

export interface BrowserTabDisconnectedEvent {
  type: "browser-tab-disconnected";
  browserProfileId: string;
  connectionId: number;
  tabCount: number;
  totalTabCount: number;
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
  "browser-tab-connected": BrowserTabConnectedEvent;
  "browser-tab-disconnected": BrowserTabDisconnectedEvent;
  "source-change": SourceChangeEvent;
  "backend-reloaded": undefined;
  "worker-activity-changed": WorkerActivityEvent;
  reconnect: undefined;
  refresh: undefined;
}

export type ActivityEventType = keyof ActivityEventMap;
type Listener<T> = (data: T) => void;

function isActivityDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__ACTIVITY_DEBUG__ === true) return true;
  try {
    return localStorage.getItem("scholaraio-activity-debug") === "true";
  } catch {
    return false;
  }
}

class ActivityBus {
  private source: EventSource | null = null;
  private listeners = new Map<ActivityEventType, Set<Listener<unknown>>>();
  private hasConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.source || typeof window === "undefined") return;

    const debug = isActivityDebugEnabled();
    const source = new EventSource("/api/activity/stream", { withCredentials: true });
    this.source = source;

    const handleConnected = () => {
      this._connected = true;
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

    source.addEventListener("connected", handleConnected);
    source.addEventListener("file-change", (event) => handleTypedEvent("file-change", event));
    source.addEventListener("session-status-changed", (event) =>
      handleTypedEvent("session-status-changed", event),
    );
    source.addEventListener("session-created", (event) =>
      handleTypedEvent("session-created", event),
    );
    source.addEventListener("session-updated", (event) =>
      handleTypedEvent("session-updated", event),
    );
    source.addEventListener("session-seen", (event) => handleTypedEvent("session-seen", event));
    source.addEventListener("process-state-changed", (event) =>
      handleTypedEvent("process-state-changed", event),
    );
    source.addEventListener("session-metadata-changed", (event) =>
      handleTypedEvent("session-metadata-changed", event),
    );
    source.addEventListener("browser-tab-connected", (event) =>
      handleTypedEvent("browser-tab-connected", event),
    );
    source.addEventListener("browser-tab-disconnected", (event) =>
      handleTypedEvent("browser-tab-disconnected", event),
    );
    source.addEventListener("source-change", (event) => handleTypedEvent("source-change", event));
    source.addEventListener("backend-reloaded", () => this.emit("backend-reloaded", undefined));
    source.addEventListener("worker-activity-changed", (event) =>
      handleTypedEvent("worker-activity-changed", event),
    );
    source.addEventListener("heartbeat", () => {
      this._connected = true;
    });

    source.onerror = () => {
      this._connected = false;
      this.source?.close();
      this.source = null;
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1000);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && this._connected) {
        this.emit("refresh", undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.hasConnected = false;
    this._connected = false;
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
}

export const activityBus = new ActivityBus();
