import type { SessionMetadataService } from "../metadata/index.js";
import type { NotificationService } from "../notifications/index.js";
import type { ExternalSessionTracker } from "../supervisor/ExternalSessionTracker.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { AgentActivity, PendingInputType, SessionSummary } from "../supervisor/types.js";
import type { ProviderGroup } from "./provider-resolution.js";

export interface EnrichDeps {
  supervisor?: Supervisor;
  externalTracker?: ExternalSessionTracker;
  notificationService?: NotificationService;
  sessionMetadataService?: SessionMetadataService;
}

export function providerMatchesGroup(provider: string | undefined, group: ProviderGroup): boolean {
  if (group === "claude") return provider === "claude" || provider === "claude-ollama";
  return provider === "codex" || provider === "codex-oss";
}

export function getOwnedSessionsForProject(
  supervisor: Supervisor | undefined,
  projectId: string,
  providerGroup?: ProviderGroup,
): Map<string, SessionSummary> {
  const ownedSessions = new Map<string, SessionSummary>();
  if (!supervisor) return ownedSessions;

  for (const process of supervisor.getAllProcesses()) {
    if (
      process.projectId === projectId &&
      (!providerGroup || providerMatchesGroup(process.provider, providerGroup))
    ) {
      const now = new Date().toISOString();
      ownedSessions.set(process.sessionId, {
        id: process.sessionId,
        projectId: process.projectId,
        title: null,
        fullTitle: null,
        createdAt: process.startedAt.toISOString(),
        updatedAt: now,
        messageCount: 0,
        ownership: {
          owner: "self",
          processId: process.id,
          permissionMode: process.permissionMode,
          modeVersion: process.modeVersion,
        },
        provider: process.provider,
      });
    }
  }
  return ownedSessions;
}

export function addMissingOwnedSessions(
  supervisor: Supervisor | undefined,
  sessions: SessionSummary[],
  projectId: string,
  providerGroup?: ProviderGroup,
): SessionSummary[] {
  const ownedSessions = getOwnedSessionsForProject(supervisor, projectId, providerGroup);
  if (ownedSessions.size === 0) return sessions;
  const existingIds = new Set(sessions.map((s) => s.id));
  const missingSessions: SessionSummary[] = [];
  for (const [sessionId, summary] of ownedSessions) {
    if (!existingIds.has(sessionId)) missingSessions.push(summary);
  }
  return [...missingSessions, ...sessions];
}

export function enrichSessions(deps: EnrichDeps, sessions: SessionSummary[]): SessionSummary[] {
  return sessions.map((session) => {
    const process = deps.supervisor?.getProcessForSession(session.id);
    const isExternal = deps.externalTracker?.isExternal(session.id) ?? false;

    const ownership = process
      ? {
          owner: "self" as const,
          processId: process.id,
          permissionMode: process.permissionMode,
          modeVersion: process.modeVersion,
        }
      : isExternal
        ? { owner: "external" as const }
        : session.ownership;

    let pendingInputType: PendingInputType | undefined;
    let activity: AgentActivity | undefined;
    if (process) {
      const pendingRequest = process.getPendingInputRequest();
      if (pendingRequest) {
        pendingInputType =
          pendingRequest.type === "tool-approval" ? "tool-approval" : "user-question";
      }
      const state = process.state.type;
      if (state === "in-turn" || state === "waiting-input") {
        activity = state;
      }
    }

    const lastSeenEntry = deps.notificationService?.getLastSeen(session.id);
    const lastSeenAt = lastSeenEntry?.timestamp;
    const hasUnread = deps.notificationService
      ? deps.notificationService.hasUnread(session.id, session.updatedAt)
      : undefined;

    const metadata = deps.sessionMetadataService?.getMetadata(session.id);

    return {
      ...session,
      ownership,
      pendingInputType,
      activity,
      lastSeenAt,
      hasUnread,
      customTitle: metadata?.customTitle,
      isArchived: metadata?.isArchived,
      isStarred: metadata?.isStarred,
    };
  });
}
