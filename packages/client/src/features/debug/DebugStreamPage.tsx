import { useQuery } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import { SessionMetadataProvider } from "../../shared/contexts/SessionMetadataContext";
import { api as sessionApi } from "../session/api/client";
import { MessageList } from "../session/components/MessageList";
import { AgentContentProvider } from "../session/contexts/AgentContentContext";
import {
  StreamingMarkdownProvider,
  useStreamingMarkdownContext,
} from "../session/contexts/StreamingMarkdownContext";
import { useSession } from "../session/hooks/useSession";
import type { Message as SessionMessage } from "../session/types";

type EventRecord = {
  seq: number;
  receivedAt: number;
  eventType: string;
  raw: string;
  parsed: unknown;
  messageId?: string;
};

type PendingInputRequest = {
  id: string;
  sessionId?: string;
  type?: string;
  prompt?: string;
  toolName?: string;
  toolInput?: unknown;
  options?: string[];
};

type ApprovalResponse = "approve" | "approve_accept_edits" | "deny";

function extractPendingRequest(parsed: unknown): PendingInputRequest | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const state = obj.state;
  const request = obj.request as Record<string, unknown> | undefined;
  if (state === "waiting-input" && request && typeof request.id === "string") {
    return {
      id: request.id,
      sessionId: typeof request.sessionId === "string" ? request.sessionId : undefined,
      type: typeof request.type === "string" ? request.type : undefined,
      prompt: typeof request.prompt === "string" ? request.prompt : undefined,
      toolName: typeof request.toolName === "string" ? request.toolName : undefined,
      toolInput: request.toolInput,
      options: Array.isArray(request.options) ? (request.options as string[]) : undefined,
    };
  }
  return null;
}

const KNOWN_EVENT_TYPES = [
  "connected",
  "message",
  "status",
  "mode-change",
  "markdown-augment",
  "pending",
  "deferred-queue",
  "session-id-changed",
  "complete",
  "heartbeat",
  "error",
] as const;

const HIDDEN_BY_DEFAULT = new Set<string>(["heartbeat"]);

function extractMessageId(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const uuid = obj.uuid;
  if (typeof uuid === "string") return uuid;
  const id = obj.id;
  if (typeof id === "string") return id;
  const inner = obj.message as Record<string, unknown> | undefined;
  if (inner && typeof inner.id === "string") return inner.id;
  return undefined;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const mmm = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

function colorForEventType(eventType: string): string {
  switch (eventType) {
    case "message":
      return "text-emerald-400";
    case "status":
      return "text-amber-400";
    case "connected":
      return "text-cyan-400";
    case "complete":
      return "text-fuchsia-400";
    case "error":
      return "text-red-400";
    case "heartbeat":
      return "text-zinc-600";
    case "markdown-augment":
    case "pending":
      return "text-violet-400";
    case "mode-change":
      return "text-orange-400";
    case "deferred-queue":
      return "text-yellow-300";
    case "session-id-changed":
      return "text-pink-400";
    default:
      return "text-zinc-300";
  }
}

function useDebugStream(
  sessionId: string | null,
  onEvent: (e: { eventType: string; raw: string }) => void,
) {
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) {
      setConnected(false);
      setLastError(null);
      return;
    }
    setLastError(null);
    const source = new EventSource(`/api/sessions/${sessionId}/stream`, {
      withCredentials: true,
    });

    const handler = (eventType: string) => (event: Event) => {
      const msg = event as MessageEvent<string>;
      onEventRef.current({ eventType, raw: msg.data ?? "" });
    };

    for (const t of KNOWN_EVENT_TYPES) {
      source.addEventListener(t, handler(t));
    }
    source.addEventListener("connected", () => setConnected(true));
    source.addEventListener("complete", () => setConnected(false));
    source.onerror = () => {
      setConnected(false);
      setLastError("connection error");
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [sessionId]);

  return { connected, lastError };
}

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

function NewSessionDialog({ open, onClose, onCreated }: NewSessionDialogProps) {
  const [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => api.getProjects({ signal }),
    select: (data) => data.projects,
    enabled: open,
  });
  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers.filter((p) => p.installed && p.authenticated),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setProjectId("");
      setProvider("");
      setBusy(false);
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleCreate = async () => {
    if (!projectId) {
      setError("select a project");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.createSession({
        projectId,
        provider: provider ? (provider as never) : undefined,
      });
      onCreated(result.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[420px] border border-zinc-700 bg-black p-5 font-mono text-xs text-zinc-200">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-emerald-400">[new session]</span>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ×
          </button>
        </div>

        <label className="mb-3 block">
          <div className="mb-1 text-zinc-500">project</div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">— select —</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.path}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block">
          <div className="mb-1 text-zinc-500">provider (optional)</div>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">— default —</option>
            {providersQuery.data?.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName} ({p.name})
              </option>
            ))}
          </select>
        </label>

        {error ? <div className="mb-3 text-red-400">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !projectId}
            className="border border-emerald-700 bg-emerald-950 px-3 py-1 text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
          >
            {busy ? "creating…" : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface EventRowProps {
  event: EventRecord;
  expanded: boolean;
  onToggle: () => void;
}

function EventRow({ event, expanded, onToggle }: EventRowProps) {
  const color = colorForEventType(event.eventType);
  const summary = useMemo(() => {
    if (!event.parsed || typeof event.parsed !== "object") return "";
    const obj = event.parsed as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.type === "string") parts.push(`type=${obj.type}`);
    if (typeof obj.subtype === "string") parts.push(`subtype=${obj.subtype}`);
    if (typeof obj.state === "string") parts.push(`state=${obj.state}`);
    if (event.messageId) parts.push(`id=${event.messageId.slice(0, 8)}`);
    return parts.join(" ");
  }, [event.parsed, event.messageId]);

  return (
    <div className="border-b border-zinc-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-zinc-900/50"
      >
        <span className="w-10 shrink-0 text-zinc-600">#{event.seq}</span>
        <span className="w-24 shrink-0 text-zinc-500">{formatTime(event.receivedAt)}</span>
        <span className={`w-40 shrink-0 ${color}`}>{event.eventType}</span>
        <span className="truncate text-zinc-400">{summary}</span>
        <span className="ml-auto shrink-0 text-zinc-600">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded ? (
        <pre className="overflow-x-auto bg-zinc-950 px-3 py-2 text-[11px] leading-relaxed text-zinc-300">
          {event.parsed ? JSON.stringify(event.parsed, null, 2) : event.raw || "(empty)"}
        </pre>
      ) : null}
    </div>
  );
}

function RenderedColumnInner({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const streamingContext = useStreamingMarkdownContext();
  const streamingCallbacks = useMemo(() => {
    if (!streamingContext) return undefined;
    return {
      onAugment: streamingContext.dispatchAugment,
      onPending: streamingContext.dispatchPending,
      onStreamEnd: streamingContext.dispatchStreamEnd,
    };
  }, [streamingContext]);

  const {
    messages,
    agentContent,
    mergeAgentContent,
    toolUseToAgent,
    markdownAugments,
    pendingMessages,
    deferredMessages,
    pagination,
    loadingOlder,
    loadOlderMessages,
    processState,
    isCompacting,
    status,
    loading,
  } = useSession(projectId, sessionId, undefined, streamingCallbacks);

  const activeToolApproval = processState === "in-turn" || processState === "waiting-input";
  const isStreaming = status.owner === "self" && processState === "in-turn";

  if (loading) {
    return <div className="p-4 text-xs text-on-surface-variant">loading…</div>;
  }

  return (
    <AgentContentProvider
      agentContent={agentContent}
      mergeAgentContent={mergeAgentContent}
      toolUseToAgent={toolUseToAgent}
      projectId={projectId}
      sessionId={sessionId}
    >
      <MessageList
        messages={messages as SessionMessage[]}
        markdownAugments={markdownAugments}
        pendingMessages={pendingMessages}
        deferredMessages={deferredMessages}
        isStreaming={isStreaming}
        isProcessing={isStreaming}
        isCompacting={isCompacting}
        activeToolApproval={activeToolApproval}
        hasOlderMessages={pagination?.hasOlderMessages ?? false}
        loadingOlder={loadingOlder}
        onLoadOlderMessages={loadOlderMessages}
      />
    </AgentContentProvider>
  );
}

function RenderedColumn({
  projectId,
  sessionId,
}: {
  projectId: string | null;
  sessionId: string | null;
}) {
  if (!projectId || !sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-zinc-600">
        select a session to render
      </div>
    );
  }
  return (
    <SessionMetadataProvider projectId={projectId} projectPath={null} sessionId={sessionId}>
      <StreamingMarkdownProvider>
        <div className="flex h-full min-h-0 flex-col bg-surface">
          <RenderedColumnInner key={sessionId} projectId={projectId} sessionId={sessionId} />
        </div>
      </StreamingMarkdownProvider>
    </SessionMetadataProvider>
  );
}

const COL1_KEY = "debug-stream-col1-width";
const COL2_KEY = "debug-stream-col2-width";
const COL_MIN = 240;
const COL_RIGHT_MIN = 320;

function loadStoredWidth(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (!stored) return fallback;
  const n = Number(stored);
  return Number.isFinite(n) && n >= COL_MIN ? n : fallback;
}

export function DebugStreamPage() {
  const navigate = useNavigate();
  const { sessionId: paramSessionId } = useParams();
  const activeSessionId = paramSessionId ?? null;

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const seqRef = useRef(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const pauseBufferRef = useRef<EventRecord[]>([]);
  const pauseRawBufferRef = useRef<string[]>([]);

  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    () => new Set(KNOWN_EVENT_TYPES.filter((t) => !HIDDEN_BY_DEFAULT.has(t))),
  );
  const [groupByMessage, setGroupByMessage] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const [pendingRequest, setPendingRequest] = useState<PendingInputRequest | null>(null);
  const [respondingTo, setRespondingTo] = useState<ApprovalResponse | null>(null);
  const [approvalError, setApprovalError] = useState("");

  const rawLogRef = useRef<HTMLDivElement | null>(null);
  const eventLogRef = useRef<HTMLDivElement | null>(null);
  const followRawRef = useRef(true);
  const followEventRef = useRef(true);

  const sessionsQuery = useQuery({
    queryKey: ["debug-sessions"],
    queryFn: ({ signal }) =>
      sessionApi.getGlobalSessions({ limit: 50, includeArchived: false }, { signal }),
    staleTime: 10_000,
  });

  const [col1Width, setCol1Width] = useState(() => loadStoredWidth(COL1_KEY, 440));
  const [col2Width, setCol2Width] = useState(() => loadStoredWidth(COL2_KEY, 520));
  const draggingRef = useRef<"col1" | "col2" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      const which = draggingRef.current;
      if (which === "col1") {
        const max = Math.max(COL_MIN, window.innerWidth - col2Width - COL_RIGHT_MIN);
        const next = Math.min(max, Math.max(COL_MIN, dragStartWidthRef.current + delta));
        setCol1Width(next);
      } else {
        const max = Math.max(COL_MIN, window.innerWidth - col1Width - COL_RIGHT_MIN);
        const next = Math.min(max, Math.max(COL_MIN, dragStartWidthRef.current + delta));
        setCol2Width(next);
      }
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      const which = draggingRef.current;
      draggingRef.current = null;
      setIsDragging(false);
      if (which === "col1") {
        setCol1Width((w) => {
          window.localStorage.setItem(COL1_KEY, String(w));
          return w;
        });
      } else {
        setCol2Width((w) => {
          window.localStorage.setItem(COL2_KEY, String(w));
          return w;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [col1Width, col2Width]);

  const startDrag = (which: "col1" | "col2") => (e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = which;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = which === "col1" ? col1Width : col2Width;
  };

  const sessionMetaQuery = useQuery({
    queryKey: ["debug-session-meta", activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return null;
      const list = await sessionApi.getGlobalSessions({ limit: 200 });
      return list.sessions.find((s) => s.id === activeSessionId) ?? null;
    },
    enabled: !!activeSessionId,
    staleTime: 30_000,
  });

  useEffect(() => {
    void activeSessionId;
    seqRef.current = 0;
    setEvents([]);
    setRawLines([]);
    setExpandedIds(new Set());
    setPendingRequest(null);
    setApprovalError("");
    pauseBufferRef.current = [];
    pauseRawBufferRef.current = [];
  }, [activeSessionId]);

  const handleApproval = async (response: ApprovalResponse) => {
    if (!activeSessionId || !pendingRequest) return;
    setRespondingTo(response);
    setApprovalError("");
    try {
      await api.respondToInput(activeSessionId, pendingRequest.id, response);
      setPendingRequest(null);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "respond failed");
    } finally {
      setRespondingTo(null);
    }
  };

  const handleStreamEvent = useCallback(
    ({ eventType, raw }: { eventType: string; raw: string }) => {
      let parsed: unknown = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      const record: EventRecord = {
        seq: seqRef.current++,
        receivedAt: Date.now(),
        eventType,
        raw,
        parsed,
        messageId: extractMessageId(parsed),
      };
      const rawLine = `event: ${eventType}\ndata: ${raw}\n`;

      if (eventType === "status" || eventType === "connected") {
        const next = extractPendingRequest(parsed);
        if (next) {
          setPendingRequest(next);
          setApprovalError("");
        } else if (parsed && typeof parsed === "object") {
          const state = (parsed as Record<string, unknown>).state;
          if (state && state !== "waiting-input") {
            setPendingRequest(null);
            setApprovalError("");
          }
        }
      } else if (eventType === "complete") {
        setPendingRequest(null);
        setApprovalError("");
      }

      if (pausedRef.current) {
        pauseBufferRef.current.push(record);
        pauseRawBufferRef.current.push(rawLine);
        return;
      }
      setEvents((prev) => [...prev, record]);
      setRawLines((prev) => [...prev, rawLine]);
    },
    [],
  );

  const { connected, lastError } = useDebugStream(activeSessionId, handleStreamEvent);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pauseBufferRef.current.length > 0) {
      const buffered = pauseBufferRef.current;
      const bufferedRaw = pauseRawBufferRef.current;
      pauseBufferRef.current = [];
      pauseRawBufferRef.current = [];
      setEvents((prev) => [...prev, ...buffered]);
      setRawLines((prev) => [...prev, ...bufferedRaw]);
    }
  }, [paused]);

  const rawCount = rawLines.length;
  const eventCount = events.length;

  useEffect(() => {
    void rawCount;
    if (followRawRef.current && rawLogRef.current) {
      rawLogRef.current.scrollTop = rawLogRef.current.scrollHeight;
    }
  }, [rawCount]);

  useEffect(() => {
    void eventCount;
    if (followEventRef.current && eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
    }
  }, [eventCount]);

  const handleRawScroll = () => {
    const el = rawLogRef.current;
    if (!el) return;
    followRawRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const handleEventScroll = () => {
    const el = eventLogRef.current;
    if (!el) return;
    followEventRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const visibleEvents = useMemo(
    () => events.filter((e) => activeTypes.has(e.eventType)),
    [events, activeTypes],
  );

  const grouped = useMemo(() => {
    if (!groupByMessage) return null;
    const map = new Map<string, EventRecord[]>();
    const ungrouped: EventRecord[] = [];
    for (const evt of visibleEvents) {
      if (evt.messageId) {
        const arr = map.get(evt.messageId) ?? [];
        arr.push(evt);
        map.set(evt.messageId, arr);
      } else {
        ungrouped.push(evt);
      }
    }
    return { map, ungrouped };
  }, [visibleEvents, groupByMessage]);

  const visibleRawText = useMemo(() => {
    if (activeTypes.size === KNOWN_EVENT_TYPES.length) return rawLines.join("\n");
    return rawLines
      .filter((line) => {
        const m = line.match(/^event: (\S+)/);
        return m?.[1] ? activeTypes.has(m[1]) : true;
      })
      .join("\n");
  }, [rawLines, activeTypes]);

  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleClear = () => {
    setEvents([]);
    setRawLines([]);
    setExpandedIds(new Set());
    pauseBufferRef.current = [];
    pauseRawBufferRef.current = [];
    seqRef.current = 0;
  };

  const toggleExpand = (seq: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const handleSelectSession = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) navigate(`/debug/stream/${id}`);
    else navigate("/debug/stream");
  };

  const handleSessionCreated = (sessionId: string) => {
    setShowNewDialog(false);
    navigate(`/debug/stream/${sessionId}`);
  };

  const handleSend = async () => {
    if (!activeSessionId || !messageDraft.trim()) return;
    const meta = sessionMetaQuery.data;
    if (!meta) {
      setSendError("session metadata not loaded");
      return;
    }
    setSending(true);
    setSendError("");
    const text = messageDraft.trim();
    try {
      if (meta.ownership?.owner === "self") {
        await api.queueMessage({
          sessionId: activeSessionId,
          message: text,
        });
      } else {
        await api.resumeSession({
          projectId: meta.projectId,
          sessionId: activeSessionId,
          message: text,
          provider: meta.provider,
        });
      }
      setMessageDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const statusLabel = !activeSessionId
    ? "no session"
    : connected
      ? "● connected"
      : lastError
        ? `○ ${lastError}`
        : "○ idle";
  const statusColor = !activeSessionId
    ? "text-zinc-600"
    : connected
      ? "text-emerald-400"
      : lastError
        ? "text-red-400"
        : "text-zinc-500";

  return (
    <div className="flex h-screen w-screen flex-col bg-black font-mono text-xs text-zinc-200">
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <span className="text-emerald-400">$</span>
        <span className="text-zinc-500">debug/stream</span>
        <select
          value={activeSessionId ?? ""}
          onChange={handleSelectSession}
          className="ml-3 max-w-[420px] flex-1 truncate border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 focus:border-emerald-400 focus:outline-none"
        >
          <option value="">— select session —</option>
          {sessionsQuery.data?.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              [{s.provider}] {s.title ?? s.id.slice(0, 8)} · {s.projectName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowNewDialog(true)}
          className="border border-emerald-700 bg-emerald-950 px-2 py-1 text-emerald-300 hover:bg-emerald-900"
        >
          + new
        </button>
        <span className={`ml-auto px-2 ${statusColor}`}>{statusLabel}</span>
        {pendingRequest ? (
          <span className="border border-amber-700 bg-amber-950 px-2 py-0.5 text-amber-300">
            ! input required
          </span>
        ) : null}
      </header>

      {pendingRequest ? (
        <div className="shrink-0 border-b border-amber-900 bg-amber-950/40 px-3 py-2">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-amber-400">[approval]</span>
            <span className="text-zinc-500">type={pendingRequest.type ?? "?"}</span>
            {pendingRequest.toolName ? (
              <span className="text-emerald-400">tool={pendingRequest.toolName}</span>
            ) : null}
            <span className="ml-auto text-zinc-600">id={pendingRequest.id.slice(0, 8)}</span>
          </div>
          {pendingRequest.prompt ? (
            <div className="mb-2 whitespace-pre-wrap text-zinc-300">{pendingRequest.prompt}</div>
          ) : null}
          {pendingRequest.toolInput !== undefined ? (
            <pre className="mb-2 max-h-48 overflow-auto border border-amber-900/60 bg-black px-2 py-1.5 text-[11px] leading-relaxed text-zinc-400">
              {JSON.stringify(pendingRequest.toolInput, null, 2)}
            </pre>
          ) : null}
          {approvalError ? <div className="mb-2 text-red-400">{approvalError}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleApproval("approve")}
              disabled={respondingTo !== null}
              className="border border-emerald-700 bg-emerald-950 px-3 py-1 text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
            >
              {respondingTo === "approve" ? "…" : "approve"}
            </button>
            <button
              type="button"
              onClick={() => void handleApproval("approve_accept_edits")}
              disabled={respondingTo !== null}
              className="border border-cyan-700 bg-cyan-950 px-3 py-1 text-cyan-300 hover:bg-cyan-900 disabled:opacity-50"
            >
              {respondingTo === "approve_accept_edits" ? "…" : "approve + accept edits"}
            </button>
            <button
              type="button"
              onClick={() => void handleApproval("deny")}
              disabled={respondingTo !== null}
              className="border border-red-700 bg-red-950 px-3 py-1 text-red-300 hover:bg-red-900 disabled:opacity-50"
            >
              {respondingTo === "deny" ? "…" : "deny"}
            </button>
          </div>
        </div>
      ) : null}

      <div className={`flex min-h-0 flex-1 ${isDragging ? "select-none" : ""}`}>
        <section className="flex flex-col border-r border-zinc-800" style={{ width: col1Width }}>
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 bg-zinc-950 px-3 py-1.5 text-zinc-500">
            <span className="text-zinc-600">raw sse</span>
            <span className="ml-auto text-zinc-700">{rawLines.length} lines</span>
          </div>
          <div
            ref={rawLogRef}
            onScroll={handleRawScroll}
            className="flex-1 overflow-auto whitespace-pre p-3 text-[11px] leading-relaxed text-zinc-400"
          >
            {visibleRawText || <span className="text-zinc-700">waiting for events…</span>}
          </div>
        </section>

        <div
          onMouseDown={startDrag("col1")}
          className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700 active:bg-emerald-500"
        />
        <section className="flex flex-col" style={{ width: col2Width }}>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-900 bg-zinc-950 px-3 py-1.5 text-zinc-500">
            {KNOWN_EVENT_TYPES.map((t) => {
              const active = activeTypes.has(t);
              return (
                <label key={t} className="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleType(t)}
                    className="accent-emerald-500"
                  />
                  <span className={active ? colorForEventType(t) : "text-zinc-700"}>{t}</span>
                </label>
              );
            })}
            <label className="ml-auto flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={groupByMessage}
                onChange={(e) => setGroupByMessage(e.target.checked)}
                className="accent-emerald-500"
              />
              <span>group</span>
            </label>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className={`border border-zinc-700 px-2 py-0.5 ${paused ? "bg-amber-950 text-amber-300" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {paused ? `resume (${pauseBufferRef.current.length})` : "pause"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
            >
              clear
            </button>
          </div>

          <div
            ref={eventLogRef}
            onScroll={handleEventScroll}
            className="flex-1 overflow-auto bg-black"
          >
            {visibleEvents.length === 0 ? (
              <div className="p-3 text-zinc-700">no events</div>
            ) : grouped ? (
              <div>
                {Array.from(grouped.map.entries()).map(([id, list]) => (
                  <details key={id} open className="border-b border-zinc-800 bg-zinc-950/40">
                    <summary className="cursor-pointer px-3 py-1.5 text-emerald-400 hover:bg-zinc-900/50">
                      message · {id.slice(0, 16)} · {list.length} events
                    </summary>
                    {list.map((evt) => (
                      <EventRow
                        key={evt.seq}
                        event={evt}
                        expanded={expandedIds.has(evt.seq)}
                        onToggle={() => toggleExpand(evt.seq)}
                      />
                    ))}
                  </details>
                ))}
                {grouped.ungrouped.length > 0 ? (
                  <details open className="border-b border-zinc-800 bg-zinc-950/40">
                    <summary className="cursor-pointer px-3 py-1.5 text-zinc-400 hover:bg-zinc-900/50">
                      no message id · {grouped.ungrouped.length} events
                    </summary>
                    {grouped.ungrouped.map((evt) => (
                      <EventRow
                        key={evt.seq}
                        event={evt}
                        expanded={expandedIds.has(evt.seq)}
                        onToggle={() => toggleExpand(evt.seq)}
                      />
                    ))}
                  </details>
                ) : null}
              </div>
            ) : (
              visibleEvents.map((evt) => (
                <EventRow
                  key={evt.seq}
                  event={evt}
                  expanded={expandedIds.has(evt.seq)}
                  onToggle={() => toggleExpand(evt.seq)}
                />
              ))
            )}
          </div>
        </section>
        <div
          onMouseDown={startDrag("col2")}
          className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700 active:bg-emerald-500"
        />
        <section className="flex min-w-0 flex-1 flex-col border-l border-zinc-800 bg-surface">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-500">
            <span className="text-zinc-600">rendered</span>
            {sessionMetaQuery.data?.projectId ? (
              <span className="ml-auto text-zinc-700">{sessionMetaQuery.data.projectName}</span>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto">
            <RenderedColumn
              projectId={sessionMetaQuery.data?.projectId ?? null}
              sessionId={activeSessionId}
            />
          </div>
        </section>
      </div>

      <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
        {sendError ? <div className="mb-1 text-red-400">{sendError}</div> : null}
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">{">"}</span>
          <input
            type="text"
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={!activeSessionId || sending}
            placeholder={
              activeSessionId ? "type message · enter to send" : "select a session first"
            }
            className="flex-1 border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-700 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!activeSessionId || sending || !messageDraft.trim()}
            className="border border-emerald-700 bg-emerald-950 px-3 py-1.5 text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
          >
            {sending ? "…" : "send"}
          </button>
        </div>
      </footer>

      <NewSessionDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={handleSessionCreated}
      />
    </div>
  );
}
