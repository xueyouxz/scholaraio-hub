import type { InputRequest } from "@scholaraio-hub/shared";
import type { AgentEvent } from "../providers/events.js";

export type ProcessState =
  | { type: "in-turn" }
  | { type: "idle" }
  | { type: "waiting-input"; request: InputRequest }
  | { type: "terminated"; reason: string; error?: Error };

/**
 * What a process tells the session it serves: each provider event, each state
 * change, and — once — that it ended, with the error when one ended it.
 */
export type ProcessEvent =
  | { type: "agent"; event: AgentEvent }
  | { type: "state-change"; state: ProcessState }
  | { type: "terminated"; reason: string; error?: Error };
