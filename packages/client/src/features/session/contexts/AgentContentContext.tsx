import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";
import { api } from "../api/client";
import type { AgentContent, AgentContentMap } from "../types/agentContent";

interface AgentContentContextValue {
  /** Map of agentId → agent content (messages + status) */
  agentContent: AgentContentMap;
  /** Mapping from Task tool_use_id → agentId (for rendering during streaming) */
  toolUseToAgent: Map<string, string>;
  /** Load agent content from server (for lazy-loading completed tasks) */
  loadAgentContent: (agentId: string) => Promise<AgentContent>;
  /** Check if content is currently being loaded for an agent */
  isLoading: (agentId: string) => boolean;
}

export const AgentContentContext = createContext<AgentContentContextValue | null>(null);

interface AgentContentProviderProps {
  children: ReactNode;
  /** Live agentContent from useSession (for streaming updates) */
  agentContent: AgentContentMap;
  /** Merge loaded content into useSession's agent-content store */
  mergeAgentContent: (agentId: string, incoming: AgentContent) => void;
  /** Mapping from Task tool_use_id → agentId (for rendering during streaming) */
  toolUseToAgent: Map<string, string>;
  projectId: string;
  sessionId: string;
}

export function AgentContentProvider({
  children,
  agentContent,
  mergeAgentContent,
  toolUseToAgent,
  projectId,
  sessionId,
}: AgentContentProviderProps) {
  // Inflight promise dedup: same agentId concurrently requested → same promise
  const inflightRef = useRef<Map<string, Promise<AgentContent>>>(new Map());
  // Agents whose JSONL has already been loaded (won't re-fetch)
  const loadedRef = useRef<Set<string>>(new Set());
  // Version bumped on inflight start/end so isLoading() can re-evaluate
  const [loadingVersion, setLoadingVersion] = useState(0);

  const loadAgentContent = useCallback(
    async (agentId: string): Promise<AgentContent> => {
      if (loadedRef.current.has(agentId)) {
        return agentContent[agentId] ?? { messages: [], status: "pending" };
      }

      // Inflight: reuse the same Promise
      const existing = inflightRef.current.get(agentId);
      if (existing) return existing;

      setLoadingVersion((v) => v + 1);
      const promise = (async (): Promise<AgentContent> => {
        try {
          const data = await api.getAgentSession(projectId, sessionId, agentId);
          loadedRef.current.add(agentId);
          const incoming: AgentContent = { messages: data.messages, status: data.status };
          mergeAgentContent(agentId, incoming);
          return incoming;
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
    [agentContent, mergeAgentContent, projectId, sessionId],
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
export function useAgentContentOptional(agentId: string | undefined): {
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
      await context.loadAgentContent(agentId);
    },
  };
}
