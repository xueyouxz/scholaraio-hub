/**
 * Resolving an AgentSession's optional controls.
 *
 * Providers implement whatever their backend supports, so `steer`, `interrupt`,
 * `setModel` and friends are optional on AgentSession. Callers used to probe
 * each one for null and repeat the "not supported" branch. Here we answer the
 * question once: a `capabilities` descriptor says what is real, and every
 * control is present afterwards, falling back to a no-op that reports failure.
 *
 * Null Object pattern: call sites stop asking "does this exist?" and ask
 * "did it work?".
 */

import type { ModelInfo, SlashCommand } from "@scholaraio-hub/shared";
import type { UserMessage } from "../types.js";
import type { AgentSession } from "./types.js";

export interface SessionCapabilities {
  /** Stop the current turn without killing the process. */
  interrupt: boolean;
  /** Add user input to a turn that is already running. */
  steer: boolean;
  /** Change the thinking budget mid-session. */
  thinkingTokens: boolean;
  /** Change the model mid-session. */
  modelSwitch: boolean;
  /** Ask the backend which models exist. */
  modelList: boolean;
  /** Ask the backend which slash commands exist. */
  commandList: boolean;
}

export interface ResolvedSessionControls {
  capabilities: SessionCapabilities;
  interrupt: () => Promise<void>;
  /** Returns false when the caller should enqueue the message instead. */
  steer: (message: UserMessage) => Promise<boolean>;
  setMaxThinkingTokens: (tokens: number | null) => Promise<void>;
  setModel: (model?: string) => Promise<void>;
  supportedModels: () => Promise<ModelInfo[]>;
  supportedCommands: () => Promise<SlashCommand[]>;
}

export function resolveSessionControls(session: AgentSession): ResolvedSessionControls {
  const capabilities: SessionCapabilities = {
    interrupt: typeof session.interrupt === "function",
    steer: typeof session.steer === "function",
    thinkingTokens: typeof session.setMaxThinkingTokens === "function",
    modelSwitch: typeof session.setModel === "function",
    modelList: typeof session.supportedModels === "function",
    commandList: typeof session.supportedCommands === "function",
  };

  return {
    capabilities,
    interrupt: session.interrupt ?? (async () => {}),
    steer: session.steer ?? (async () => false),
    setMaxThinkingTokens: session.setMaxThinkingTokens ?? (async () => {}),
    setModel: session.setModel ?? (async () => {}),
    supportedModels: session.supportedModels ?? (async () => []),
    supportedCommands: session.supportedCommands ?? (async () => []),
  };
}
