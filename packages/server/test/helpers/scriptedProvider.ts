import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type {
  AgentProvider,
  AgentSession,
  AuthStatus,
  StartSessionOptions,
} from "../../src/sdk/providers/types.js";
import type { SDKMessage } from "../../src/sdk/types.js";

export interface ScriptedProviderOptions {
  /** Recorded start options, in call order. */
  startCalls?: StartSessionOptions[];
  /**
   * Keep the session iterator open after the scripted messages, so the process
   * stays registered until it is aborted. Used by worker-pool tests.
   */
  holdOpen?: boolean;
  /** Assistant reply emitted after the init message (omit for silence). */
  reply?: string;
}

/**
 * Minimal AgentProvider for supervisor tests: emits an init message carrying the
 * session id, an optional assistant reply, then a result.
 *
 * This replaces the old bespoke mock SDK interfaces — tests now exercise the
 * same provider path as production.
 */
export function createScriptedProvider(options: ScriptedProviderOptions = {}): AgentProvider {
  let nextSession = 1;
  return {
    name: "claude",
    displayName: "Scripted",
    supportsPermissionMode: true,
    supportsThinkingToggle: true,
    supportsSlashCommands: false,
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

      async function* iterator(): AsyncIterableIterator<SDKMessage> {
        yield { type: "system", subtype: "init", session_id: sessionId };
        if (options.reply) {
          yield {
            type: "assistant",
            session_id: sessionId,
            message: { role: "assistant", content: options.reply },
          };
        }
        if (options.holdOpen) {
          while (!aborted) await new Promise((resolve) => setTimeout(resolve, 10));
          return;
        }
        yield { type: "result", session_id: sessionId };
      }

      return {
        iterator: iterator(),
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
    supportsPermissionMode: true,
    supportsThinkingToggle: true,
    supportsSlashCommands: false,
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
