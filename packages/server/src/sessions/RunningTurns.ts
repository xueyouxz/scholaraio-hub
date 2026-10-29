import type { SessionSummary } from "@scholaraio-hub/shared";
import type { Turn } from "./Turn.js";

/**
 * The turn each session is running, by session id (a new session's placeholder
 * at first). The SessionService starts and ends turns; the lists read here what
 * the Hub is doing in each session, without depending on the service.
 */
export class RunningTurns extends Map<string, Turn> {
  /** What the Hub is doing in a session now (`SessionSummary.state`). */
  activity(key: string): SessionSummary["state"] {
    const turn = this.get(key);
    if (!turn || turn.finished) return undefined;
    return turn.record.state === "waiting-input" ? "waiting-input" : "running";
  }
}
