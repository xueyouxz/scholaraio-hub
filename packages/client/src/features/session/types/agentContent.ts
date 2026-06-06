import type { Message } from "../types";

/** Content from a subagent (Task tool). */
export interface AgentContent {
  messages: Message[];
  status: "pending" | "running" | "completed" | "failed";
  /** Real-time context usage from message_start events. */
  contextUsage?: {
    inputTokens: number;
    percentage: number;
  };
}

/** Map of agentId -> agent content. */
export type AgentContentMap = Record<string, AgentContent>;
