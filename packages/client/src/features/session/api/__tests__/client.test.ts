import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";

function jsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("session global sessions api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes provider filters to global session requests and filters mixed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementationOnce(() =>
        jsonResponse({
          projects: [
            {
              id: "project-1",
              name: "Project One",
            },
          ],
          hasMore: false,
          stats: {
            totalCount: 2,
            unreadCount: 0,
            starredCount: 0,
            archivedCount: 0,
            providerCounts: {},
            executorCounts: {},
          },
          sessions: [
            {
              id: "claude-session",
              title: "Claude session",
              createdAt: "2026-05-20T00:00:00.000Z",
              updatedAt: "2026-05-20T00:00:00.000Z",
              messageCount: 1,
              provider: "claude",
              projectId: "project-1",
              ownership: { owner: "none" },
            },
            {
              id: "codex-session",
              title: "Codex session",
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:00:00.000Z",
              messageCount: 1,
              provider: "codex",
              projectId: "project-1",
              ownership: { owner: "none" },
            },
            {
              id: "codex-oss-session",
              title: "Codex OSS session",
              createdAt: "2026-05-22T00:00:00.000Z",
              updatedAt: "2026-05-22T00:00:00.000Z",
              messageCount: 1,
              provider: "codex-oss",
              projectId: "project-1",
              ownership: { owner: "none" },
            },
          ],
        }),
      ),
    );

    const result = await api.getGlobalSessions({
      project: "project-1",
      provider: "codex",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions?project=project-1&provider=codex",
      expect.any(Object),
    );
    expect(result.sessions.map((session) => session.id)).toEqual([
      "codex-session",
      "codex-oss-session",
    ]);
  });
});
