/**
 * Provider exports.
 *
 * Phase 4 MVP trim: only Claude and Codex providers remain exposed.
 */

import type { AgentProvider, ProviderName } from "./types.js";
export type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

import { claudeProvider } from "./claude.js";
export { ClaudeProvider, claudeProvider } from "./claude.js";

import { codexProvider } from "./codex.js";
export {
  CodexProvider,
  codexProvider,
  type CodexProviderConfig,
} from "./codex.js";

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
