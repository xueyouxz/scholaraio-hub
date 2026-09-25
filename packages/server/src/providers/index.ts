/**
 * The providers this Hub runs: Claude and Codex.
 */

import type { AgentProvider, ProviderName } from "./types.js";
export type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

import { claudeProvider } from "./claude/ClaudeProvider.js";
export { ClaudeProvider, claudeProvider } from "./claude/ClaudeProvider.js";

import { codexProvider } from "./codex/CodexProvider.js";
export {
  CodexProvider,
  codexProvider,
  type CodexProviderConfig,
} from "./codex/CodexProvider.js";

export function getAllProviders(): AgentProvider[] {
  return [claudeProvider, codexProvider];
}

export function getProvider(name: ProviderName): AgentProvider | null {
  switch (name) {
    case "claude":
      return claudeProvider;
    case "codex":
      return codexProvider;
    default:
      return null;
  }
}
