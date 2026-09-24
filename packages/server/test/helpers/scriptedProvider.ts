import { ATTACHMENT_LIMITS, type ProviderCapabilities } from "@scholaraio-hub/shared";
import type { AgentEvent } from "../../src/agent/events.js";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  StartSessionOptions,
} from "../../src/sdk/providers/types.js";

export interface ScriptedProviderOptions {
  /** Recorded start options, in call order. */
  startCalls?: StartSessionOptions[];
  /**
   * Keep the session iterator open after the scripted messages, so the process
   * stays registered until it is aborted.
   */
  holdOpen?: boolean;
  /** Assistant reply emitted after the init message (omit for silence). */
  reply?: string;
}

/**
 * Minimal AgentProvider for supervisor tests: announces the session, emits an
 * optional reply, then completes the turn.
 *
 * This replaces the old bespoke mock SDK interfaces — tests now exercise the
 * same provider path as production.
 */
/** Capabilities for fake providers: every hub permission mode, no thinking switch. */
export const TEST_CAPABILITIES: ProviderCapabilities = {
  permissionModes: [
    { id: "default", label: "Default" },
    { id: "acceptEdits", label: "Accept edits" },
    { id: "plan", label: "Plan Mode" },
    { id: "bypassPermissions", label: "Bypass Permissions" },
  ],
  thinkingModes: [],
  slashCommands: "leading",
  contextUsage: "used",
  attachments: ATTACHMENT_LIMITS,
};

export function createScriptedProvider(options: ScriptedProviderOptions = {}): AgentProvider {
  let nextSession = 1;
  return {
    name: "claude",
    displayName: "Scripted",
    capabilities: TEST_CAPABILITIES,
    isInstalled: async () => true,
    isAuthenticated: async () => true,
    getAuthStatus: async (): Promise<AuthStatus> => ({
      installed: true,
      authenticated: true,
      enabled: true,
    }),
    getAvailableModels: async () => [],
    startSession: async (startOptions: StartSessionOptions): Promise<AgentSession> => {
      options.startCalls?.push(startOptions);
      const sessionId = startOptions.resumeSessionId ?? `scripted-${nextSession++}`;
      const queue = new MessageQueue();
      if (startOptions.initialMessage) queue.push(startOptions.initialMessage);
      let aborted = false;

      async function* events(): AsyncIterableIterator<AgentEvent> {
        yield { type: "session.started", sessionId };
        if (options.reply) {
          yield { type: "text.delta", blockId: `${sessionId}-reply`, delta: options.reply };
        }
        if (options.holdOpen) {
          while (!aborted) await new Promise((resolve) => setTimeout(resolve, 10));
          return;
        }
        yield { type: "turn.completed" };
      }

      return {
        events: events(),
        queue,
        sessionId,
        abort: () => {
          aborted = true;
        },
      };
    },
  };
}

/**
 * Wrap a bare session factory as an AgentProvider, for tests that only care
 * about what the provider yields.
 */
export function providerFromSessionFactory(
  startSession: (options: StartSessionOptions) => Promise<AgentSession>,
  name: AgentProvider["name"] = "claude",
): AgentProvider {
  return {
    name,
    displayName: "Scripted",
    capabilities: TEST_CAPABILITIES,
    isInstalled: async () => true,
    isAuthenticated: async () => true,
    getAuthStatus: async (): Promise<AuthStatus> => ({
      installed: true,
      authenticated: true,
      enabled: true,
    }),
    getAvailableModels: async () => [],
    startSession,
  };
}
