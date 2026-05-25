import {
  type ProviderName,
  type SlashCommand,
  getModelContextWindow,
} from "@scholaraio-hub/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { getMessageId } from "../lib/mergeMessages";
import { findPendingTasks } from "../lib/pendingTasks";
import { extractSessionIdFromFileEvent } from "../lib/sessionFile";
import type {
  InputRequest,
  MarkdownAugment,
  Message,
  PermissionMode,
  SessionStatus,
} from "../types";
import {
  type FileChangeEvent,
  type ProcessStateEvent,
  type SessionStatusEvent,
  type SessionUpdatedEvent,
  useFileActivity,
} from "./useFileActivity";
import {
  type AgentContentMap,
  type SessionLoadResult,
  useSessionMessages,
} from "./useSessionMessages";
import { useSessionStream } from "./useSessionStream";
import { useSessionWatchStream } from "./useSessionWatchStream";
import { type StreamingMarkdownCallbacks, useStreamingContent } from "./useStreamingContent";

export type ProcessState = "idle" | "in-turn" | "waiting-input" | "hold";

function isProcessState(value: unknown): value is ProcessState {
  return value === "idle" || value === "in-turn" || value === "waiting-input" || value === "hold";
}

// Re-export types from useSessionMessages
export type { AgentContent, AgentContentMap } from "./useSessionMessages";

const THROTTLE_MS = 500;

// Re-export StreamingMarkdownCallbacks for consumers
export type { StreamingMarkdownCallbacks } from "./useStreamingContent";

/** Pending message waiting for server confirmation */
export interface PendingMessage {
  tempId: string;
  content: string;
  timestamp: string;
  /** Display status text (e.g. "Uploading...", "Sending..."). Defaults to "Sending..." */
  status?: string;
}

/** Deferred message queued server-side, waiting for agent's turn to end */
export interface DeferredMessage {
  tempId?: string;
  content: string;
  timestamp: string;
}

function extractUserMessageText(sdkMessage: Record<string, unknown>): string | null {
  const message = sdkMessage.message as { content?: unknown; role?: unknown } | undefined;
  const content = message?.content;

  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .filter((part) => part.length > 0);
    if (textParts.length === 0) return null;
    const joined = textParts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }

  return null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useSession(
  projectId: string,
  sessionId: string,
  initialStatus?: { owner: "self"; processId: string },
  streamingMarkdownCallbacks?: StreamingMarkdownCallbacks,
) {
  // Use initial status if provided (from navigation state) to connect stream immediately
  const [status, setStatus] = useState<SessionStatus>(initialStatus ?? { owner: "none" });
  // If we have initial status, assume process is in-turn (just started)
  const [processState, setProcessState] = useState<ProcessState>(
    initialStatus ? "in-turn" : "idle",
  );
  const [pendingInputRequest, setPendingInputRequest] = useState<InputRequest | null>(null);
  const pendingInputRequestRef = useRef<InputRequest | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Actual session ID from server (may differ from URL sessionId during temp→real ID transition)
  // This happens when createSession returns before the SDK sends the real session ID
  const [actualSessionId, setActualSessionId] = useState<string>(sessionId);

  // Track last stream activity timestamp for engagement tracking
  // This includes both main session and subagent messages, so we can properly
  // mark sessions as "seen" even when subagent content arrives (which doesn't
  // update the parent session file's mtime until completion)
  const [lastStreamActivityAt, setLastStreamActivityAt] = useState<string | null>(null);

  // Pending messages queue - messages waiting for server confirmation
  // These are displayed separately from the main message list
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);

  // Deferred messages queue - messages queued server-side waiting for agent's turn to end
  const [deferredMessages, setDeferredMessages] = useState<DeferredMessage[]>([]);

  useEffect(() => {
    if (status.owner !== "none") return;
    setProcessState("idle");
    setPendingInputRequest(null);
    setDeferredMessages([]);
  }, [status.owner]);

  // Keep ref in sync so event handlers can read the current value without
  // capturing stale closure state (avoids performing API calls inside setState).
  useEffect(() => {
    pendingInputRequestRef.current = pendingInputRequest;
  }, [pendingInputRequest]);

  // Compacting state - true when context is being compressed
  const [isCompacting, setIsCompacting] = useState(false);

  // Markdown augments loaded from REST response (keyed by message ID)
  const [markdownAugments, setMarkdownAugments] = useState<Record<string, MarkdownAugment>>({});

  // Permission mode state: localMode is UI-selected, serverMode is confirmed by server
  const [localMode, setLocalMode] = useState<PermissionMode>("default");
  const [serverMode, setServerMode] = useState<PermissionMode>("default");
  const [modeVersion, setModeVersion] = useState<number>(0);
  // Track whether we've already processed a stream "connected" event in this mount.
  // For Codex providers, the first connected-event catch-up fetch can duplicate
  // freshly streamed messages because JSONL and stream IDs are not yet aligned.
  const hasHandledConnectedEventRef = useRef(false);

  // Reset connected-event tracking when switching sessions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally runs on session switches
  useEffect(() => {
    hasHandledConnectedEventRef.current = false;
  }, [sessionId]);

  // Skill slash commands available for this session.
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  // Tools available for this session (from init message)
  const [sessionTools, setSessionTools] = useState<string[]>([]);
  // MCP servers available for this session (from init message)
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const lastKnownModeVersionRef = useRef<number>(0);

  // Apply server mode update only if version is >= our last known version
  // This syncs both local and server mode to the confirmed value
  const applyServerModeUpdate = useCallback((mode: PermissionMode, version: number) => {
    if (version >= lastKnownModeVersionRef.current) {
      lastKnownModeVersionRef.current = version;
      setServerMode(mode);
      setLocalMode(mode); // Sync local to server-confirmed mode
      setModeVersion(version);
    }
  }, []);

  const applyRuntimeSnapshot = useCallback(
    (snapshot: {
      ownership: SessionStatus & { state?: unknown };
      pendingInputRequest?: InputRequest | null;
    }) => {
      setStatus(snapshot.ownership);

      const serverState = snapshot.ownership.state;
      if (snapshot.ownership.owner === "none" || serverState === "terminated") {
        setProcessState("idle");
        setPendingInputRequest(null);
        setDeferredMessages([]);
        return;
      }

      if (isProcessState(serverState)) {
        setProcessState(serverState);
      }

      if (serverState === "waiting-input" && snapshot.pendingInputRequest) {
        setPendingInputRequest(snapshot.pendingInputRequest);
      } else if (serverState !== "waiting-input") {
        setPendingInputRequest(null);
      }
    },
    [],
  );

  const refreshRuntimeState = useCallback(async () => {
    const snapshot = await api.getSessionMetadata(projectId, sessionId);
    applyRuntimeSnapshot(snapshot);
    return snapshot;
  }, [applyRuntimeSnapshot, projectId, sessionId]);

  // Handle initial load completion from useSessionMessages
  const handleLoadComplete = useCallback(
    (result: SessionLoadResult) => {
      // Only update status from REST if we don't already have an owned status from navigation.
      // This prevents a race condition where:
      // 1. Session created with initialStatus = {owner: "self"}
      // 2. stream connects because status.owner === "self"
      // 3. REST API returns status = {owner: "none"} (stale)
      // 4. setStatus({owner: "none"}) disconnects stream before it receives events
      // The owned status from initialStatus should only be changed by stream events.
      setStatus((prev) => {
        // If we already have owned status (from initialStatus), keep it unless REST also says owned
        if (prev.owner === "self" && result.status.owner !== "self") {
          return prev;
        }
        return result.status;
      });

      // Sync permission mode from server if owned
      if (
        result.status.owner === "self" &&
        result.status.permissionMode &&
        result.status.modeVersion !== undefined
      ) {
        applyServerModeUpdate(result.status.permissionMode, result.status.modeVersion);
      }
      // Set pending input request from API response immediately
      // This fixes race condition where stream connection is delayed but tool approval is pending
      if (result.pendingInputRequest) {
        setPendingInputRequest(result.pendingInputRequest as InputRequest);
      }
      // Set slash commands from API response so the "/" button appears reliably
      // (the SSE init message that normally carries these is discarded after ~30s)
      setSlashCommands(
        (result.slashCommands ?? []).map((command) => ({
          ...command,
          description: command.description ?? "",
        })),
      );
    },
    [applyServerModeUpdate],
  );

  // Handle initial load error
  const handleLoadError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const handleRefreshError = useCallback((err: Error) => {
    setError(err);
  }, []);

  // Use the session messages hook for message state and stream buffering
  const {
    messages,
    agentContent,
    toolUseToAgent,
    loading,
    session,
    setSession,
    handleStreamingUpdate,
    handleStreamMessageEvent,
    handleStreamSubagentMessage,
    registerToolUseAgent,
    setAgentContent,
    setToolUseToAgent,
    setMessages,
    fetchNewMessages,
    fetchSessionMetadata,
    pagination,
    loadingOlder,
    loadOlderMessages,
  } = useSessionMessages({
    projectId,
    sessionId,
    onLoadComplete: handleLoadComplete,
    onLoadError: handleLoadError,
    onRefreshError: handleRefreshError,
  });

  // Update local mode (UI selection) and sync to server if process is active
  const setPermissionMode = useCallback(
    async (mode: PermissionMode) => {
      setLocalMode(mode);

      // If there's an active process, immediately sync to server
      if (status.owner === "self" || status.owner === "external") {
        try {
          const result = await api.setPermissionMode(sessionId, mode);
          // Update server-confirmed mode
          if (result.modeVersion >= lastKnownModeVersionRef.current) {
            lastKnownModeVersionRef.current = result.modeVersion;
            setServerMode(result.permissionMode);
            setModeVersion(result.modeVersion);
          }
        } catch (err) {
          // If API fails (e.g., no active process), mode will be sent on next message
          console.warn("Failed to sync permission mode:", err);
        }
      }
    },
    [sessionId, status.owner],
  );

  // Set hold state (soft pause) for the session
  const setHold = useCallback(
    async (hold: boolean) => {
      // Only works if there's an active process
      if (status.owner !== "self" && status.owner !== "external") {
        console.warn("Cannot set hold: no active process");
        return;
      }

      try {
        const result = await api.setHold(sessionId, hold);
        // Process state will be updated via stream state-change event
        // but we can optimistically update if needed
        if (result.state === "hold") {
          setProcessState("hold");
        } else if (result.state === "in-turn") {
          setProcessState("in-turn");
        }
      } catch (err) {
        console.warn("Failed to set hold:", err);
      }
    },
    [sessionId, status.owner],
  );

  // Throttle state for incremental fetching
  const throttleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: boolean;
  }>({ timer: null, pending: false });

  // Debounce timer for stream error handling. SSE onerror fires on any transient
  // network blip. We wait 1.5 s (> the 1 s minimum reconnect delay) before
  // querying the server so a quick recovery doesn't reset the UI to idle.
  const streamErrorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add a message to the pending queue
  // Generates a tempId that will be sent to the server and echoed back in stream
  const addPendingMessage = useCallback((content: string): string => {
    const tempId = `temp-${Date.now()}`;
    setPendingMessages((prev) => [
      ...prev,
      { tempId, content, timestamp: new Date().toISOString() },
    ]);
    return tempId;
  }, []);

  // Remove a pending message by tempId (used when server confirms or send fails)
  const removePendingMessage = useCallback((tempId: string) => {
    setPendingMessages((prev) => prev.filter((p) => p.tempId !== tempId));
  }, []);

  // Update a pending message's fields (e.g. status text)
  const updatePendingMessage = useCallback((tempId: string, updates: Partial<PendingMessage>) => {
    setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...updates } : p)));
  }, []);

  // Track if we've loaded pending agents for this session
  const pendingAgentsLoadedRef = useRef<string | null>(null);

  // Load pending agent content on session load
  // This handles page reload while Tasks are running: loads agent content-so-far
  useEffect(() => {
    // Only run once per session after initial load
    if (loading || pendingAgentsLoadedRef.current === sessionId) return;
    if (messages.length === 0) return;

    const loadPendingAgents = async () => {
      // Mark as loaded to prevent re-running
      pendingAgentsLoadedRef.current = sessionId;

      // Find pending Tasks (tool_use without matching tool_result)
      const pendingTasks = findPendingTasks(messages);
      if (pendingTasks.length === 0) return;

      try {
        // Get agent mappings (toolUseId → agentId)
        const { mappings } = await api.getAgentMappings(projectId, sessionId);
        const mappingsMap = new Map(mappings.map((m) => [m.toolUseId, m.agentId]));

        // Update the toolUseToAgent state with loaded mappings
        // This allows TaskRenderer to access agentContent even after page reload
        setToolUseToAgent((prev) => {
          const next = new Map(prev);
          for (const [toolUseId, agentId] of mappingsMap) {
            if (!next.has(toolUseId)) {
              next.set(toolUseId, agentId);
            }
          }
          return next;
        });

        // Load content for each pending task that has an agent file
        for (const task of pendingTasks) {
          const agentId = mappingsMap.get(task.toolUseId);
          if (!agentId) continue;

          try {
            const agentData = await api.getAgentSession(projectId, sessionId, agentId);

            // Merge into agentContent state, deduping by message ID
            // Use getMessageId to prefer uuid over id
            setAgentContent((prev) => {
              const existing = prev[agentId];
              if (existing && existing.messages.length > 0) {
                // Already have content (maybe from stream), merge without duplicates
                const existingIds = new Set(existing.messages.map((m) => getMessageId(m)));
                const newMessages = agentData.messages.filter(
                  (m) => !existingIds.has(getMessageId(m)),
                );
                return {
                  ...prev,
                  [agentId]: {
                    messages: [...existing.messages, ...newMessages],
                    status: agentData.status,
                  },
                };
              }
              // No existing content, use loaded data
              return {
                ...prev,
                [agentId]: agentData,
              };
            });
          } catch (error) {
            console.warn("[useSession] failed to load pending agent session", {
              agentId,
              error,
            });
          }
        }
      } catch (error) {
        console.warn("[useSession] failed to load pending agent mappings", error);
      }
    };

    loadPendingAgents();
  }, [loading, messages, projectId, sessionId, setAgentContent, setToolUseToAgent]);

  // Leading + trailing edge throttle:
  // - Leading: fires immediately on first call
  // - Trailing: fires again after timeout if events came during window
  // This ensures no updates are lost
  const throttledFetch = useCallback(() => {
    const ref = throttleRef.current;

    if (!ref.timer) {
      // No active throttle - fire immediately (LEADING EDGE)
      fetchNewMessages();
      ref.timer = setTimeout(() => {
        ref.timer = null;
        if (ref.pending) {
          ref.pending = false;
          throttledFetch(); // Fire again (TRAILING EDGE)
        }
      }, THROTTLE_MS);
    } else {
      // Throttled - mark as pending for trailing edge
      ref.pending = true;
    }
  }, [fetchNewMessages]);

  // Handle file changes - for non-owned sessions only
  // For owned sessions, stream provides real-time messages and session-updated events
  // provide metadata (title, messageCount), so we don't need to poll the API
  const handleFileChange = useCallback(
    (event: FileChangeEvent) => {
      // Only care about session files
      if (event.fileType !== "session" && event.fileType !== "agent-session") {
        return;
      }

      // Check if file matches current session (exact match to avoid false positives)
      // File format is: projects/<projectId>/<sessionId>.jsonl
      const fileSessionId = extractSessionIdFromFileEvent(event);
      if (fileSessionId !== sessionId) {
        return;
      }

      // For owned sessions: messages come via stream stream, metadata via session-updated event
      // No API call needed - skip file change processing entirely
      if (status.owner === "self") {
        return;
      }

      // For external/idle sessions: fetch both messages and metadata via API
      throttledFetch();
    },
    [sessionId, status.owner, throttledFetch],
  );

  // Handle session content updates via stream (title, messageCount, updatedAt, contextUsage)
  const handleSessionUpdated = useCallback(
    (event: SessionUpdatedEvent) => {
      if (event.sessionId !== sessionId) return;

      // Update session metadata from stream event (no API call needed)
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(event.title !== undefined && { title: event.title }),
          ...(event.messageCount !== undefined && {
            messageCount: event.messageCount,
          }),
          ...(event.updatedAt !== undefined && {
            updatedAt: event.updatedAt,
          }),
          ...(event.contextUsage !== undefined && {
            contextUsage: event.contextUsage,
          }),
          ...(event.model !== undefined && { model: event.model }),
        };
      });
    },
    [sessionId, setSession],
  );

  // Listen for session status changes via stream
  const handleSessionStatusChange = useCallback(
    (event: SessionStatusEvent) => {
      if (event.sessionId === sessionId) {
        setStatus(event.ownership);
      }
    },
    [sessionId],
  );

  // Listen for process state changes via activity bus as a backup for session stream
  // This handles the race condition where the session stream might miss a status event
  // (e.g., when backgrounding the tab quickly after starting a session)
  const handleProcessStateChange = useCallback(
    async (event: ProcessStateEvent) => {
      if (event.sessionId !== sessionId) return;

      if (event.activity === "terminated") {
        setStatus({ owner: "none" });
        setProcessState("idle");
        setPendingInputRequest(null);
        setDeferredMessages([]);
        return;
      }

      // Update process state from activity bus
      if (
        event.activity === "idle" ||
        event.activity === "in-turn" ||
        event.activity === "waiting-input" ||
        event.activity === "hold"
      ) {
        setProcessState(event.activity);
      }

      if (event.activity !== "waiting-input") {
        setPendingInputRequest(null);
      }

      // If activity bus says waiting-input but we don't have the request,
      // fetch it via REST as a backup. Read via ref to avoid a side effect
      // inside a setState updater (which React may call more than once).
      if (event.activity === "waiting-input" && event.pendingInputType) {
        if (!pendingInputRequestRef.current) {
          api
            .getSessionMetadata(projectId, sessionId)
            .then((result) => {
              if (result.pendingInputRequest) {
                setPendingInputRequest(result.pendingInputRequest);
              }
            })
            .catch((error) => {
              const err = toError(error);
              console.warn("[useSession] failed to refresh pending input request", err);
              setError(err);
            });
        }
      }
    },
    [projectId, sessionId],
  );

  // Handle activity bus reconnection (e.g., after phone screen wake).
  // Catches up on messages and ownership changes that occurred while disconnected.
  // Without this, a session that completed while the screen was off would show stale
  // data because the session stream unsubscribes when ownership becomes "none" and
  // nobody triggers fetchNewMessages().
  const handleActivityReconnect = useCallback(async () => {
    fetchNewMessages();
    try {
      await refreshRuntimeState();
    } catch (error) {
      const err = toError(error);
      console.warn("[useSession] failed to refresh runtime state after activity reconnect", err);
      setError(err);
    }
  }, [fetchNewMessages, refreshRuntimeState]);

  useFileActivity({
    onSessionStatusChange: handleSessionStatusChange,
    onFileChange: handleFileChange,
    onSessionUpdated: handleSessionUpdated,
    onProcessStateChange: handleProcessStateChange,
    onReconnect: handleActivityReconnect,
  });

  // Focused watch stream for non-owned sessions.
  // This is a targeted server-side watch of the currently viewed session file,
  // independent from broad global activity-tree watch behavior.
  const handleSessionWatchChange = useCallback(() => {
    if (status.owner === "self") return;
    throttledFetch();
  }, [status.owner, throttledFetch]);

  const { connected: sessionWatchConnected } = useSessionWatchStream(
    status.owner !== "self"
      ? {
          sessionId,
          projectId,
          provider: session?.provider,
        }
      : null,
    {
      onChange: handleSessionWatchChange,
    },
  );

  // Cleanup throttle timers
  useEffect(() => {
    return () => {
      if (throttleRef.current.timer) {
        clearTimeout(throttleRef.current.timer);
      }
      if (streamErrorDebounceRef.current) {
        clearTimeout(streamErrorDebounceRef.current);
      }
    };
  }, []);

  // Callback for agent context usage updates
  const handleAgentContextUsage = useCallback(
    (agentId: string, usage: { inputTokens: number; percentage: number }) => {
      setAgentContent((prev) => {
        const existing = prev[agentId] ?? {
          messages: [],
          status: "running",
        };
        return {
          ...prev,
          [agentId]: { ...existing, contextUsage: usage },
        };
      });
    },
    [setAgentContent],
  );

  // Use streaming content hook for handling stream_event stream messages
  const {
    handleStreamEvent,
    clearStreaming,
    cleanup: cleanupStreaming,
  } = useStreamingContent({
    onUpdateMessage: handleStreamingUpdate,
    onToolUseMapping: registerToolUseAgent,
    onAgentContextUsage: handleAgentContextUsage,
    contextWindowSize: getModelContextWindow(session?.model, session?.provider),
    streamingMarkdownCallbacks,
  });

  // Cleanup streaming timers on unmount
  useEffect(() => {
    return () => {
      cleanupStreaming();
    };
  }, [cleanupStreaming]);

  // Subscribe to live updates
  const handleStreamMessage = useCallback(
    (data: { eventType: string; [key: string]: unknown }) => {
      if (data.eventType === "message") {
        // ─── message 事件分发器 ───────────────────────────────────────────
        // 这是 SSE 三种事件里"结构化骨架"那一支，承载所有 SDK 原始消息。
        // 内部还有第二层 type 分流：stream_event(增量) / assistant(终态) / user / system 等

        // 记录最后一次流式活动时间，用于 engagement tracking。
        // 子 agent 消息也算（不会更新父会话文件 mtime），所以要在这里手动打点
        setLastStreamActivityAt(new Date().toISOString());

        // SSE 推来的对象就是 SDK 原始消息体，全字段透传不剥任何字段
        const sdkMessage = data as Record<string, unknown> & {
          eventType: string;
        };

        // 取 ID 的三级兜底：uuid（最终消息）→ id（中间事件）→ 本地时间戳生成
        const rawUuid = sdkMessage.uuid;
        const rawId = sdkMessage.id;
        const id: string =
          (typeof rawUuid === "string" ? rawUuid : null) ??
          (typeof rawId === "string" ? rawId : null) ??
          `msg-${Date.now()}`;

        // 取 type 和 role 用于后续分流
        const msgType = typeof sdkMessage.type === "string" ? sdkMessage.type : undefined;
        const msgRole = sdkMessage.role as Message["role"] | undefined;

        // stream_event 子类型：Anthropic 流式增量（message_start / content_block_delta / message_stop）
        // 委托给 useStreamingContent 做 delta 积累 + 50ms 节流，处理完直接 return
        if (msgType === "stream_event") {
          if (handleStreamEvent(sdkMessage)) {
            return; // 已被 streaming 子系统消费，不走下面的合并逻辑
          }
        }

        // assistant 子类型：一轮回复的"最终消息"（带 uuid，已写 JSONL）。
        // 此时所有 _isStreaming 占位消息都要被这条真实消息替换掉。
        if (msgType === "assistant") {
          // 子 agent 的最终消息要路由到 agentContent[agentId] 而不是主消息流。
          // 路由 key 用 parentToolUseId（也就是 Task 工具自身的 tool_use_id）。
          const isSubagentMsg =
            sdkMessage.isSubagent && typeof sdkMessage.parentToolUseId === "string";
          const msgAgentId = isSubagentMsg ? (sdkMessage.parentToolUseId as string) : undefined;

          // 让 useStreamingContent 清掉它内部的 ref Map 与 currentStreamingIdRef
          clearStreaming();

          if (msgAgentId) {
            // 子 agent 流结束：删掉这个 agent 下面所有 _isStreaming 占位
            setAgentContent((prev) => {
              const existing = prev[msgAgentId];
              if (!existing) return prev;
              const filtered = existing.messages.filter((m) => !m._isStreaming);
              if (filtered.length === existing.messages.length) return prev;
              return {
                ...prev,
                [msgAgentId]: { ...existing, messages: filtered },
              };
            });
          } else {
            // 主流结束：把主消息列表里所有 _isStreaming 占位删掉，
            // 紧接着下面 handleStreamMessageEvent 会把真实消息插入
            setMessages((prev) => prev.filter((m) => !m._isStreaming));
          }
        }

        // 构造内部 Message 对象，保留 SDK 全部字段（tool_use/tool_result/usage 等都不能丢）
        const incoming: Message = {
          ...(sdkMessage as Partial<Message>),
          id,
          type: msgType,
          // 保证 user/assistant 类型一定有 role 字段，避免渲染层误判
          role: msgRole ?? (msgType === "user" || msgType === "assistant" ? msgType : undefined),
        };

        // eventType 是 SSE 信封字段，不属于消息本体，去掉
        (incoming as { eventType?: string }).eventType = undefined;

        // init 消息携带本会话可用的 skills / tools / mcp_servers。
        // 不取 slash_commands —— Claude CLI 自带的命令在网页端没法执行，会误导用户。
        if (msgType === "system" && sdkMessage.subtype === "init") {
          if (Array.isArray(sdkMessage.skills)) {
            setSlashCommands((prev) => {
              const descriptions = new Map(prev.map((command) => [command.name, command]));
              return (sdkMessage.skills as string[]).map((name) => ({
                ...descriptions.get(name),
                name,
                description: descriptions.get(name)?.description ?? "",
              }));
            });
          }
          if (Array.isArray(sdkMessage.tools)) {
            setSessionTools(sdkMessage.tools as string[]);
          }
          if (Array.isArray(sdkMessage.mcp_servers)) {
            setMcpServers(sdkMessage.mcp_servers as string[]);
          }
        }

        // system/status：上下文压缩指示器（开始压缩 vs 压缩中），是瞬时状态不入消息列表
        if (msgType === "system" && sdkMessage.subtype === "status") {
          const status = sdkMessage.status as "compacting" | null;
          setIsCompacting(status === "compacting");
          return; // 不追加到 messages[]
        }

        // compact_boundary：压缩完成的边界标记，清掉指示器；但这条消息本身要进列表
        // 因为前端要在这里画一条"已压缩"的分隔线
        if (msgType === "system" && sdkMessage.subtype === "compact_boundary") {
          setIsCompacting(false);
        }

        // tempId 是前端发消息时生成的临时 ID，服务端会在用户消息回显时带回。
        // 收到带 tempId 的 user 消息 → 从 pendingMessages 队列里删掉对应的乐观占位
        const tempId = sdkMessage.tempId as string | undefined;
        if (msgType === "user" && tempId) {
          removePendingMessage(tempId);
        } else if (msgType === "user") {
          // 某些 provider（如 Codex）不带 tempId 回显，退而求其次按内容匹配
          // 只删一条匹配的，避免误删用户重复发送的相同内容
          const incomingText = extractUserMessageText(sdkMessage);
          if (incomingText) {
            setPendingMessages((prev) => {
              const idx = prev.findIndex((p) => p.content.trim() === incomingText);
              if (idx === -1) return prev;
              return prev.filter((_, i) => i !== idx);
            });
          }
        }

        // 子 agent 消息路由：分流到 agentContent[agentId] 而非主 messages[]。
        // 这样主会话的 DAG（依赖图）保持干净，UI 上 Task 工具面板可以独立展开嵌套查看。
        if (sdkMessage.isSubagent && typeof sdkMessage.parentToolUseId === "string") {
          const agentId = sdkMessage.parentToolUseId;

          // 第一次见到这个子 agent 时记录 toolUseId → agentId 映射。
          // 注意：当前实现里 agentId === parentToolUseId === toolUseId（同一个值），
          // 所以这个映射本质是恒等映射，但保留这层为未来可能的解耦做好准备
          registerToolUseAgent(agentId, agentId);

          handleStreamSubagentMessage(incoming, agentId);
          return; // 子 agent 消息不进主消息列表
        }

        // 主消息流：交给 useSessionMessages 去做"初始加载前缓冲 + 合并去重"
        handleStreamMessageEvent(incoming);
      } else if (data.eventType === "status") {
        const statusData = data as {
          eventType: string;
          state: string;
          request?: InputRequest;
        };
        if (statusData.state === "terminated") {
          setProcessState("idle");
          setStatus({ owner: "none" });
          setPendingInputRequest(null);
          setDeferredMessages([]);
          return;
        }
        // Track process state (in-turn, idle, waiting-input, hold)
        if (
          statusData.state === "idle" ||
          statusData.state === "in-turn" ||
          statusData.state === "waiting-input" ||
          statusData.state === "hold"
        ) {
          setProcessState(statusData.state as ProcessState);
        }
        // Capture pending input request when waiting for user input
        if (statusData.state === "waiting-input" && statusData.request) {
          setPendingInputRequest(statusData.request);
          // Also update actualSessionId from request in case it differs from URL
          // This handles the temp→real ID transition when state-change arrives
          // after the connected event (which may have had the temp ID)
          if (statusData.request.sessionId && statusData.request.sessionId !== sessionId) {
            setActualSessionId(statusData.request.sessionId);
          }
        } else {
          // Clear pending request when state changes away from waiting-input
          setPendingInputRequest(null);
        }
      } else if (data.eventType === "deferred-queue") {
        const deferredData = data as {
          eventType: string;
          messages: DeferredMessage[];
        };
        setDeferredMessages(deferredData.messages ?? []);
      } else if (data.eventType === "complete") {
        setProcessState("idle");
        setStatus({ owner: "none" });
        setPendingInputRequest(null);
        setDeferredMessages([]);
      } else if (data.eventType === "connected") {
        // SSE reconnected — cancel any pending error-debounce so we don't
        // mistakenly reset ownership after a transient blip that recovered.
        if (streamErrorDebounceRef.current) {
          clearTimeout(streamErrorDebounceRef.current);
          streamErrorDebounceRef.current = null;
        }

        // Sync state and permission mode from connected event
        const connectedData = data as {
          eventType: string;
          sessionId?: string;
          state?: string;
          permissionMode?: PermissionMode;
          modeVersion?: number;
          request?: InputRequest;
          provider?: ProviderName;
          model?: string;
          deferredMessages?: DeferredMessage[];
        };

        // Update actual session ID if server reports a different one
        // This handles the temp→real ID transition when createSession returns
        // before the SDK sends the real session ID
        // Check both the connected event's sessionId and the request's sessionId
        const serverSessionId = connectedData.sessionId ?? connectedData.request?.sessionId;
        if (serverSessionId && serverSessionId !== sessionId) {
          setActualSessionId(serverSessionId);
        }

        if (connectedData.state === "terminated") {
          setProcessState("idle");
          setStatus({ owner: "none" });
          setPendingInputRequest(null);
          setDeferredMessages([]);
          return;
        }

        // Sync process state so watching tabs see "processing" indicator
        if (
          connectedData.state === "idle" ||
          connectedData.state === "in-turn" ||
          connectedData.state === "waiting-input" ||
          connectedData.state === "hold"
        ) {
          setProcessState(connectedData.state as ProcessState);
        }
        // Restore pending input request if state is waiting-input, clear if not
        // (handles reconnection after another tab already approved/denied)
        if (connectedData.state === "waiting-input" && connectedData.request) {
          setPendingInputRequest(connectedData.request);
        } else {
          setPendingInputRequest(null);
        }
        if (connectedData.permissionMode && connectedData.modeVersion !== undefined) {
          applyServerModeUpdate(connectedData.permissionMode, connectedData.modeVersion);
        }

        // Update session with provider/model from connected event (belt-and-suspenders)
        // This ensures the ProviderBadge shows even if the initial session load returned
        // incomplete data (e.g., JSONL not yet written for new sessions)
        const sseProvider = connectedData.provider;
        const sseModel = connectedData.model;
        if (sseProvider) {
          setSession((prev) => {
            if (!prev) return prev;
            // Always update model if the connected event has a resolved model
            // (provider won't change, but model resolves from undefined/"Default" to actual name)
            return {
              ...prev,
              provider: prev.provider || sseProvider,
              ...(sseModel && { model: sseModel }),
            };
          });
        }

        // Sync deferred messages from connected event
        setDeferredMessages(connectedData.deferredMessages ?? []);

        // Fetch messages from JSONL since last known message.
        // For Codex providers, skip the very first connected-event fetch because
        // it can duplicate fresh stream messages (ID mismatch between stream and
        // early JSONL normalization). Reconnects still fetch as normal.
        const connectedProvider = connectedData.provider ?? session?.provider;
        const isCodexProvider = connectedProvider === "codex" || connectedProvider === "codex-oss";
        const isFirstConnectedEvent = !hasHandledConnectedEventRef.current;
        hasHandledConnectedEventRef.current = true;

        if (!(isFirstConnectedEvent && isCodexProvider)) {
          fetchNewMessages();
        }
      } else if (data.eventType === "mode-change") {
        // Handle mode change from another tab/client
        const modeData = data as {
          eventType: string;
          permissionMode?: PermissionMode;
          modeVersion?: number;
        };
        if (modeData.permissionMode && modeData.modeVersion !== undefined) {
          applyServerModeUpdate(modeData.permissionMode, modeData.modeVersion);
        }
      } else if (data.eventType === "markdown-augment") {
        // ─── markdown-augment 事件：服务端预渲染好的稳定 HTML 块 ────────────
        // 服务端跑了 shiki 高亮 / katex 数学 / mermaid 图 / safe-markdown sanitize，
        // 前端拿到现成 HTML 直接塞 DOM（dangerouslySetInnerHTML），避免在浏览器里
        // 跑一遍重型的 markdown 解析管线（rehype + 一堆插件）。
        const augmentData = data as {
          eventType: string;
          blockIndex?: number;
          html: string;
          type?: string;
          messageId?: string;
        };

        // 两种形态需要分别处理：
        //   ① 最终消息整体 HTML：有 messageId，没 blockIndex
        //     → 存进 markdownAugments[uuid]，MessageList 渲染完成消息时直接用
        //     → 这条 augment 会随 JSONL 持久化，重渲染/页面刷新都能复用
        //   ② 流式中刚闭合的某个块（如代码块写完了）：有 blockIndex + type
        //     → 派发给 StreamingMarkdownContext，由当前流式 TextBlock 接收并替换占位
        if (augmentData.messageId && augmentData.blockIndex === undefined && augmentData.html) {
          // 形态①：键到 uuid 永久保存
          setMarkdownAugments((prev) => ({
            ...prev,
            [augmentData.messageId as string]: { html: augmentData.html },
          }));
        } else if (augmentData.blockIndex !== undefined) {
          // 形态②：派发到流式总线，TextBlock 通过 ref 直接操作 DOM 插入
          // 这条路径完全绕开 React diff，是高频更新下保证流畅度的关键
          streamingMarkdownCallbacks?.onAugment?.({
            blockIndex: augmentData.blockIndex,
            html: augmentData.html,
            type: augmentData.type ?? "text",
            messageId: augmentData.messageId,
          });
        }
      } else if (data.eventType === "pending") {
        // ─── pending 事件：还没闭合那一段的"活" HTML ───────────────────────
        // 每个 text delta 都会触发一次，是真正的"打字预览"。
        // 仅含 inline 格式化（**加粗** / `行内代码` / [链接]），重型块（代码块/数学）
        // 不会出现在这里——它们会等闭合后由 markdown-augment 推送。
        const pendingData = data as {
          eventType: string;
          html: string;
        };
        // 直接派发到 TextBlock，pendingRef 整段替换，零 React state 变更
        streamingMarkdownCallbacks?.onPending?.({
          html: pendingData.html,
        });
      } else if (data.eventType === "session-id-changed") {
        // Handle session ID change (temp ID → real SDK ID)
        // This event means the URL should be updated to use the new session ID
        const changeData = data as {
          eventType: string;
          oldSessionId: string;
          newSessionId: string;
        };
        if (changeData.newSessionId && changeData.newSessionId !== sessionId) {
          setActualSessionId(changeData.newSessionId);
          // Also update pendingInputRequest.sessionId if it matches the old ID
          // This prevents approval panel from hiding due to ID mismatch after
          // the temp→real transition
          setPendingInputRequest((prev) => {
            if (prev && prev.sessionId === changeData.oldSessionId) {
              return { ...prev, sessionId: changeData.newSessionId };
            }
            return prev;
          });
        }
      }
    },
    [
      applyServerModeUpdate,
      sessionId,
      handleStreamEvent,
      clearStreaming,
      removePendingMessage,
      streamingMarkdownCallbacks,
      handleStreamMessageEvent,
      handleStreamSubagentMessage,
      registerToolUseAgent,
      setAgentContent,
      setMessages,
      setSession,
      fetchNewMessages,
      session?.provider,
    ],
  );

  // Handle stream errors by checking if process is still alive.
  // Debounced by 1.5 s so a transient network blip that reconnects within the
  // SSE backoff window (minimum 1 s) doesn't flash the UI to idle and back.
  // The "connected" SSE event cancels the debounce when reconnection succeeds.
  const handleStreamError = useCallback(() => {
    if (streamErrorDebounceRef.current) clearTimeout(streamErrorDebounceRef.current);
    streamErrorDebounceRef.current = setTimeout(async () => {
      streamErrorDebounceRef.current = null;
      try {
        const data = await api.getSessionMetadata(projectId, sessionId);
        if (data.ownership.owner !== "self") {
          setStatus({ owner: "none" });
          setProcessState("idle");
        }
      } catch (error) {
        console.warn("[useSession] failed to check session metadata after stream error", error);
        setStatus({ owner: "none" });
        setProcessState("idle");
      }
    }, 1500);
  }, [projectId, sessionId]);

  // Only connect to session stream when we own the session
  // External sessions are tracked via the activity stream instead
  const { connected, reconnect: reconnectStream } = useSessionStream(
    status.owner === "self" ? sessionId : null,
    { onMessage: handleStreamMessage, onError: handleStreamError },
  );

  const sessionUpdatesConnected =
    status.owner === "self"
      ? connected
      : status.owner === "external"
        ? sessionWatchConnected
        : false;

  // Allow external model update (e.g., after /model command switches mid-session)
  const setSessionModel = useCallback(
    (model: string) => {
      setSession((prev) => (prev ? { ...prev, model } : prev));
    },
    [setSession],
  );

  return {
    session,
    setSessionModel,
    messages,
    agentContent, // Subagent messages keyed by agentId (for Task tool)
    setAgentContent, // Setter for merging lazy-loaded agent content
    toolUseToAgent, // Mapping from Task tool_use_id → agentId (for rendering during streaming)
    markdownAugments, // Pre-rendered markdown HTML from REST response (keyed by blockId)
    status,
    processState,
    isCompacting, // True when context is being compressed
    isHeld: processState === "hold", // Derived from process state
    pendingInputRequest,
    actualSessionId, // Real session ID from server (may differ from URL during temp→real transition)
    permissionMode: localMode, // UI-selected mode (sent with next message)
    modeVersion,
    loading,
    error,
    connected,
    sessionWatchConnected,
    sessionUpdatesConnected,
    lastStreamActivityAt, // Last stream message timestamp for engagement tracking
    setStatus,
    setProcessState,
    setPermissionMode,
    setHold, // Set hold (soft pause) state
    pendingMessages, // Messages waiting for server confirmation
    addPendingMessage, // Add to pending queue, returns tempId
    removePendingMessage, // Remove from pending by tempId
    updatePendingMessage, // Update pending message fields (e.g. status)
    deferredMessages, // Messages queued server-side waiting for agent turn to end
    slashCommands, // Available slash commands from init message
    sessionTools, // Available tools from init message
    mcpServers, // Available MCP servers from init message
    pagination, // Compact-boundary pagination metadata
    loadingOlder, // Whether older messages are being loaded
    loadOlderMessages, // Load next chunk of older messages
    reconnectStream, // Force session stream reconnection (e.g., after process restart)
    refreshRuntimeState, // Reconcile ownership/activity from server metadata
  };
}
