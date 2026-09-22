/**
 * Everything the supervisor announces to the rest of the server.
 *
 * Collected here so the supervisor keeps process lifecycle logic and this file
 * keeps event shapes: the emit calls were interleaved with the scheduling code
 * they described, and each one repeated the same "skip when no bus" guard.
 */

import {
  type AgentActivity,
  type PendingInputType,
  type ProviderName,
  SESSION_TITLE_MAX_LENGTH,
  type UrlProjectId,
} from "@scholaraio-hub/shared";
import type {
  EventBus,
  ProcessStateEvent,
  ProcessTerminatedEvent,
  SessionAbortedEvent,
  SessionCreatedEvent,
  SessionStatusEvent,
  SessionUpdatedEvent,
  WorkerActivityEvent,
} from "../watcher/EventBus.js";
import type { Process } from "./Process.js";
import type { SessionOwnership, SessionSummary } from "./types.js";

/** Delays for the initial title/messageCount reconciliation after creation. */
const INITIAL_RECONCILE_DELAYS_MS = [1000, 3000] as const;

/** Callback that fetches the authoritative summary for reconciliation. */
export type OnSessionSummaryCallback = (
  sessionId: string,
  projectId: UrlProjectId,
) => Promise<SessionSummary | null>;

export interface WorkerSnapshot {
  activeWorkers: number;
  queueLength: number;
  hasActiveWork: boolean;
}

/**
 * Seed a newly created session with what we already know, so the UI can show
 * a title before the transcript has been read back from disk.
 */
function buildOptimisticSessionSeed(process: Process): {
  title: string | null;
  fullTitle: string | null;
  messageCount: number;
} {
  const fullTitle = process.firstUserText?.trim() ?? "";
  if (!fullTitle) {
    return { title: null, fullTitle: null, messageCount: 0 };
  }

  const title =
    fullTitle.length <= SESSION_TITLE_MAX_LENGTH
      ? fullTitle
      : `${fullTitle.slice(0, SESSION_TITLE_MAX_LENGTH - 3)}...`;

  return { title, fullTitle, messageCount: 1 };
}

export class SupervisorEvents {
  constructor(
    private readonly eventBus?: EventBus,
    private readonly onSessionSummary?: OnSessionSummaryCallback,
  ) {}

  emitSessionAborted(sessionId: string, projectId: UrlProjectId): void {
    if (!this.eventBus) return;

    const event: SessionAbortedEvent = {
      type: "session-aborted",
      sessionId,
      projectId,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }

  emitOwnershipChange(
    sessionId: string,
    projectId: UrlProjectId,
    ownership: SessionOwnership,
  ): void {
    if (!this.eventBus) return;

    const event: SessionStatusEvent = {
      type: "session-status-changed",
      sessionId,
      projectId,
      ownership,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }

  emitSessionCreated(process: Process, ownership: SessionOwnership): void {
    if (!this.eventBus) return;

    const now = new Date().toISOString();
    const optimistic = buildOptimisticSessionSeed(process);
    const session: SessionSummary = {
      id: process.sessionId,
      projectId: process.projectId,
      title: optimistic.title,
      fullTitle: optimistic.fullTitle,
      createdAt: now,
      updatedAt: now,
      messageCount: optimistic.messageCount,
      ownership,
      provider: process.provider,
    };

    const event: SessionCreatedEvent = {
      type: "session-created",
      session,
      timestamp: now,
    };
    this.eventBus.emit(event);
  }

  scheduleInitialSessionReconciliation(sessionId: string, projectId: UrlProjectId): void {
    if (!this.eventBus || !this.onSessionSummary) return;

    for (const delayMs of INITIAL_RECONCILE_DELAYS_MS) {
      const timer = setTimeout(() => {
        void this.emitReconciledSessionUpdate(sessionId, projectId);
      }, delayMs);
      timer.unref();
    }
  }

  async emitReconciledSessionUpdate(sessionId: string, projectId: UrlProjectId): Promise<void> {
    if (!this.eventBus || !this.onSessionSummary) return;

    const summary = await this.onSessionSummary(sessionId, projectId);
    if (!summary) return;

    const event: SessionUpdatedEvent = {
      type: "session-updated",
      sessionId,
      projectId,
      title: summary.title,
      messageCount: summary.messageCount,
      updatedAt: summary.updatedAt,
      contextUsage: summary.contextUsage,
      model: summary.model,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }

  emitAgentActivityChange(
    sessionId: string,
    projectId: UrlProjectId,
    activity: AgentActivity,
    pendingInputType?: PendingInputType,
  ): void {
    if (!this.eventBus) return;

    const event: ProcessStateEvent = {
      type: "process-state-changed",
      sessionId,
      projectId,
      activity,
      pendingInputType,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }

  emitProcessTerminated(
    sessionId: string,
    projectId: UrlProjectId,
    processId: string,
    provider: ProviderName,
    reason: string,
  ): void {
    if (!this.eventBus) return;

    const event: ProcessTerminatedEvent = {
      type: "process-terminated",
      sessionId,
      projectId,
      processId,
      provider,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }

  /**
   * Emit worker activity event for safe restart indicator.
   * Called when workers are added, removed, or change state.
   */
  emitWorkerActivity(snapshot: WorkerSnapshot): void {
    if (!this.eventBus) return;

    const event: WorkerActivityEvent = {
      type: "worker-activity-changed",
      activeWorkers: snapshot.activeWorkers,
      queueLength: snapshot.queueLength,
      hasActiveWork: snapshot.hasActiveWork,
      timestamp: new Date().toISOString(),
    };
    this.eventBus.emit(event);
  }
}
