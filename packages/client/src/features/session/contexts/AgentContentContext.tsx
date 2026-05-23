import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";
import { api } from "../api/client";
import type { AgentContent, AgentContentMap } from "../hooks/useSession";
import { getMessageId } from "../lib/mergeMessages";
import type { Message } from "../types";

interface AgentContentContextValue {
  /** Map of agentId → agent content (messages + status) */
  agentContent: AgentContentMap;
  /** Mapping from Task tool_use_id → agentId (for rendering during streaming) */
  toolUseToAgent: Map<string, string>;
  /** Load agent content from server (for lazy-loading completed tasks) */
  loadAgentContent: (
    projectId: string,
    sessionId: string,
    agentId: string,
  ) => Promise<AgentContent>;
  /** Check if content is currently being loaded for an agent */
  isLoading: (agentId: string) => boolean;
  /** The current project ID */
  projectId: string;
}

export const AgentContentContext = createContext<AgentContentContextValue | null>(null);

interface AgentContentProviderProps {
  children: ReactNode;
  /** Live agentContent from useSession (for streaming updates) */
  agentContent: AgentContentMap;
  /** Update agentContent state (for merging loaded content) */
  setAgentContent: React.Dispatch<React.SetStateAction<AgentContentMap>>;
  /** Mapping from Task tool_use_id → agentId (for rendering during streaming) */
  toolUseToAgent: Map<string, string>;
  projectId: string;
  sessionId: string;
}

function mergeAgentMessages(
  existing: AgentContent | undefined,
  jsonlMessages: Message[],
  serverStatus: AgentContent["status"],
): AgentContent {
  const existingMessages = existing?.messages ?? [];
  // Dedupe by message ID — JSONL is canonical; keep SSE-only messages
  const messageMap = new Map<string, Message>();
  for (const m of jsonlMessages) {
    messageMap.set(getMessageId(m), m);
  }
  for (const m of existingMessages) {
    const id = getMessageId(m);
    if (!messageMap.has(id)) {
      messageMap.set(id, m);
    }
  }
  // Keep "running" status from SSE if it is currently running
  const status = existing?.status === "running" ? "running" : serverStatus;
  return {
    messages: Array.from(messageMap.values()),
    status,
  };
}

export function AgentContentProvider({
  children,
  agentContent,
  setAgentContent,
  toolUseToAgent,
  projectId,
  sessionId: _sessionId,
}: AgentContentProviderProps) {
  // Inflight promise dedup: same agentId concurrently requested → same promise
  const inflightRef = useRef<Map<string, Promise<AgentContent>>>(new Map());
  // Agents whose JSONL has already been loaded (won't re-fetch)
  const loadedRef = useRef<Set<string>>(new Set());
  // Version bumped on inflight start/end so isLoading() can re-evaluate
  const [loadingVersion, setLoadingVersion] = useState(0);

  const loadAgentContent = useCallback(
    async (
      loadProjectId: string,
      loadSessionId: string,
      agentId: string,
    ): Promise<AgentContent> => {
      // Already loaded: read latest value from setter (avoids stale closure)
      if (loadedRef.current.has(agentId)) {
        return new Promise<AgentContent>((resolve) => {
          setAgentContent((prev) => {
            resolve(prev[agentId] ?? { messages: [], status: "pending" });
            return prev;
          });
        });
      }

      // Inflight: reuse the same Promise
      const existing = inflightRef.current.get(agentId);
      if (existing) return existing;

      setLoadingVersion((v) => v + 1);
      const promise = (async (): Promise<AgentContent> => {
        try {
          const data = await api.getAgentSession(loadProjectId, loadSessionId, agentId);
          loadedRef.current.add(agentId);
          let merged: AgentContent = { messages: data.messages, status: data.status };
          setAgentContent((prev) => {
            merged = mergeAgentMessages(prev[agentId], data.messages, data.status);
            return { ...prev, [agentId]: merged };
          });
          return merged;
        } catch (error) {
          console.error(`Failed to load agent content for ${agentId}:`, error);
          return { messages: [], status: "failed" };
        } finally {
          inflightRef.current.delete(agentId);
          setLoadingVersion((v) => v + 1);
        }
      })();

      inflightRef.current.set(agentId, promise);
      return promise;
    },
    [setAgentContent],
  );

  // Recreated each render so that loadingVersion-driven re-renders propagate to consumers.
  // The body reads the live inflight Map; loadingVersion's only role is to trigger re-render.
  void loadingVersion;
  const isLoading = (agentId: string) => inflightRef.current.has(agentId);

  const value: AgentContentContextValue = {
    agentContent,
    toolUseToAgent,
    loadAgentContent,
    isLoading,
    projectId,
  };

  return <AgentContentContext.Provider value={value}>{children}</AgentContentContext.Provider>;
}

/**
 * Hook to access agent content context.
 * Provides access to subagent messages and lazy-loading functionality.
 */
export function useAgentContent() {
  const context = useContext(AgentContentContext);
  if (!context) {
    throw new Error("useAgentContent must be used within an AgentContentProvider");
  }
  return context;
}

/**
 * Hook to get agent content for a specific agentId.
 * Returns null if context is not available (graceful degradation).
 */
export function useAgentContentOptional(
  agentId: string | undefined,
  sessionId?: string,
  projectId?: string,
): {
  content: AgentContent | undefined;
  isLoading: boolean;
  load: () => Promise<void>;
} | null {
  const context = useContext(AgentContentContext);
  if (!context || !agentId) {
    return null;
  }

  return {
    content: context.agentContent[agentId],
    isLoading: context.isLoading(agentId),
    load: async () => {
      if (!projectId || !sessionId) return;
      await context.loadAgentContent(projectId, sessionId, agentId);
    },
  };
}
