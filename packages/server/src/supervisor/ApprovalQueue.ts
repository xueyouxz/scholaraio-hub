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
    const isFirst = this.pending.size === 0;
    return new Promise<ToolApprovalResult>((resolve) => {
      this.pending.set(request.id, { request, resolve });
      this.order.push(request.id);

      const onAbort = () => {
        if (!this.pending.has(request.id)) return;
        this.remove(request.id);
        if (isFirst) this.advance();
        resolve({ behavior: "deny", message: "Operation aborted", interrupt: true });
      };
      signal.addEventListener("abort", onAbort, { once: true });

      // Later requests wait their turn silently.
      if (isFirst) this.hooks.onShow(request);
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
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    pending.resolve(result);
    this.remove(requestId);
    this.advance();
    return true;
  }

  /** Deny everything still waiting, e.g. when the process dies. */
  denyAll(message: string): void {
    for (const pending of this.pending.values()) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
    }
    this.pending.clear();
    this.order = [];
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
