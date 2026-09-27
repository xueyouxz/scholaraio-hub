/**
 * Pending tool approvals for one process.
 *
 * A provider can ask about several tools at once, but the user is only ever
 * shown one question at a time: the queue keeps FIFO order, surfaces the head,
 * and advances when an answer, an abort, or process termination retires it.
 *
 * The queue owns the waiting promises. What an answer *means* (allow/deny,
 * mode switches) stays with the AgentProcess — this is bookkeeping only.
 */

import type { InputRequest } from "@scholaraio-hub/shared";
import type { ToolApprovalResult } from "../providers/types.js";

interface PendingApproval {
  request: InputRequest;
  resolve: (result: ToolApprovalResult) => void;
  /** Stop listening for the turn's abort once the request is retired. */
  detach: () => void;
}

export interface ApprovalQueueHooks {
  /** Show this request to the user. */
  onShow(request: InputRequest): void;
  /** Nothing is waiting any more. */
  onDrained(): void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private order: string[] = [];

  constructor(private readonly hooks: ApprovalQueueHooks) {}

  get size(): number {
    return this.pending.size;
  }

  /** The request currently in front of the user, if any. */
  peek(): InputRequest | null {
    const firstId = this.order[0];
    return firstId === undefined ? null : (this.pending.get(firstId)?.request ?? null);
  }

  /**
   * Wait for the user's answer to `request`. Resolves with a denial if the
   * turn is aborted first.
   */
  ask(request: InputRequest, signal: AbortSignal): Promise<ToolApprovalResult> {
    return new Promise<ToolApprovalResult>((resolve) => {
      const onAbort = () =>
        this.retire(request.id, {
          behavior: "deny",
          message: "Operation aborted",
          interrupt: true,
        });
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(request.id, {
        request,
        resolve,
        detach: () => signal.removeEventListener("abort", onAbort),
      });
      this.order.push(request.id);
      // Later requests wait their turn silently.
      if (this.order.length === 1) this.hooks.onShow(request);
    });
  }

  /** Look up a waiting request without retiring it. */
  get(requestId: string): InputRequest | null {
    return this.pending.get(requestId)?.request ?? null;
  }

  /**
   * Answer a waiting request and show the next one.
   * Returns false when the id is unknown (already answered or aborted).
   */
  settle(requestId: string, result: ToolApprovalResult): boolean {
    if (!this.pending.has(requestId)) return false;
    this.retire(requestId, result);
    return true;
  }

  /**
   * Deny everything still waiting, e.g. when the process dies or its turn
   * ends. Nothing is shown afterwards; the caller sets the process state.
   */
  denyAll(message: string): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    this.order = [];
    for (const approval of pending) {
      approval.detach();
      approval.resolve({ behavior: "deny", message, interrupt: true });
    }
  }

  /** Resolve one request; when it was the one shown, show the next. */
  private retire(requestId: string, result: ToolApprovalResult): void {
    const approval = this.pending.get(requestId);
    if (!approval) return;
    const shown = this.order[0] === requestId;
    this.remove(requestId);
    approval.detach();
    approval.resolve(result);
    if (shown) this.advance();
  }

  private remove(requestId: string): void {
    this.pending.delete(requestId);
    this.order = this.order.filter((id) => id !== requestId);
  }

  private advance(): void {
    const next = this.peek();
    if (next) this.hooks.onShow(next);
    else this.hooks.onDrained();
  }
}
