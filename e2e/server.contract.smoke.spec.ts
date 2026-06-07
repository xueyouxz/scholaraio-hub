import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

// The /api/version endpoint reports the server package's own version, so pin
// the expectation to that (not a hardcoded string) — it changes on every
// changesets release.
const serverVersion = (
  createRequire(import.meta.url)("../packages/server/package.json") as { version: string }
).version;

function extractMessageText(message: {
  content?: unknown;
  message?: { content?: unknown };
}): string | undefined {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (typeof message.message?.content === "string") {
    return message.message.content;
  }

  return undefined;
}

test("exposes the core server read contracts against fixture-backed state", async ({ request }) => {
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  const healthJson = (await health.json()) as { status: string };
  expect(healthJson.status).toBe("ok");

  const version = await request.get("/api/version");
  expect(version.ok()).toBe(true);
  const versionJson = (await version.json()) as {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    resumeProtocolVersion: number;
    capabilities: string[];
  };
  expect(versionJson.current).toBe(serverVersion);
  expect(versionJson.latest).toBe(serverVersion);
  expect(versionJson.updateAvailable).toBe(false);
  expect(versionJson.resumeProtocolVersion).toBeGreaterThan(0);
  expect(versionJson.capabilities).toContain("voiceInput");

  const projects = await request.get("/api/projects");
  expect(projects.ok()).toBe(true);
  const projectsJson = (await projects.json()) as {
    projects: Array<{
      id: string;
      path: string;
      name: string;
      provider: string;
      sessionCount: number;
    }>;
  };
  const project = projectsJson.projects.find((entry) => entry.path === "/workspace/alpha");
  expect(project).toBeTruthy();
  expect(project).toMatchObject({
    name: "alpha",
    provider: "claude",
    sessionCount: 1,
  });

  const sessions = await request.get(`/api/projects/${project?.id}/sessions`);
  expect(sessions.ok()).toBe(true);
  const sessionsJson = (await sessions.json()) as {
    sessions: Array<{
      id: string;
      title: string | null;
      provider: string;
      messageCount: number;
    }>;
  };
  expect(sessionsJson.sessions).toHaveLength(1);
  expect(sessionsJson.sessions[0]).toMatchObject({
    id: "sess-existing",
    title: "Summarize the repo state.",
    provider: "claude",
    messageCount: 2,
  });

  const metadata = await request.get(
    `/api/projects/${project?.id}/sessions/sess-existing/metadata`,
  );
  expect(metadata.ok()).toBe(true);
  const metadataJson = (await metadata.json()) as {
    session: {
      id: string;
      title: string | null;
      provider: string;
      messageCount: number;
    };
    ownership: { owner: string };
  };
  expect(metadataJson.session).toMatchObject({
    id: "sess-existing",
    title: "Summarize the repo state.",
    provider: "claude",
    messageCount: 2,
  });
  expect(metadataJson.ownership.owner).toBe("none");

  const sessionDetail = await request.get(`/api/projects/${project?.id}/sessions/sess-existing`);
  expect(sessionDetail.ok()).toBe(true);
  const sessionDetailJson = (await sessionDetail.json()) as {
    session: { id: string; title: string | null; provider: string };
    messages: Array<{ type: string; content: unknown }>;
    ownership: { owner: string };
  };
  expect(sessionDetailJson.session).toMatchObject({
    id: "sess-existing",
    title: "Summarize the repo state.",
    provider: "claude",
  });
  expect(sessionDetailJson.messages).toHaveLength(2);
  expect(sessionDetailJson.messages[0]?.type).toBe("user");
  expect(extractMessageText(sessionDetailJson.messages[0] ?? {})).toBe("Summarize the repo state.");
  expect(sessionDetailJson.messages[1]?.type).toBe("assistant");
  expect(extractMessageText(sessionDetailJson.messages[1] ?? {})).toBe("Repo state summary here.");
  expect(sessionDetailJson.ownership.owner).toBe("none");

  const processes = await request.get("/api/processes?includeTerminated=true");
  expect(processes.ok()).toBe(true);
  const processesJson = (await processes.json()) as {
    processes: unknown[];
    terminatedProcesses: unknown[];
  };
  expect(processesJson.processes).toEqual([]);
  expect(processesJson.terminatedProcesses).toEqual([]);
});
