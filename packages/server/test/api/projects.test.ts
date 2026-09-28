import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirectoryRules, projectId } from "../../src/projects/directories.js";
import type { NativeSession } from "../../src/providers/types.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";
import { createTestApp } from "../helpers/app.js";
import { offlineLibrary } from "../helpers/library.js";

const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

const stored = (id: string, cwd: string, updatedAt: string): NativeSession => ({
  id,
  cwd,
  title: `title ${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
});

describe("projects from the providers' own histories", () => {
  let root: string;
  let alpha: string;
  let beta: string;
  let chat: string;
  let claude: WorkbenchProvider;
  let codex: WorkbenchProvider;
  let server: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "hub-projects-")));
    const home = join(root, "home");
    alpha = join(root, "work", "alpha");
    beta = join(root, "work", "beta");
    chat = join(home, "Documents", "Codex", "2026-09-27", "new-chat");
    for (const directory of [alpha, beta, chat]) await mkdir(directory, { recursive: true });
    claude = new WorkbenchProvider("claude");
    codex = new WorkbenchProvider("codex");
    claude.stored = [
      stored("c1", alpha, "2026-09-03T00:00:00.000Z"),
      stored("c2", beta, "2026-09-05T00:00:00.000Z"),
      stored("gone", join(root, "work", "deleted"), "2026-09-09T00:00:00.000Z"),
    ];
    codex.stored = [
      stored("x1", alpha, "2026-09-04T00:00:00.000Z"),
      stored("x2", chat, "2026-09-06T00:00:00.000Z"),
    ];
    server = createTestApp({
      dataDir: join(root, "data"),
      providers: [claude, codex],
      library: offlineLibrary(),
      directories: new DirectoryRules({ home, dataDir: join(root, "data"), temporary: [] }),
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const get = async (url: string) => {
    const response = await server.app.request(url);
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };

  it("groups both providers' sessions by directory, newest first", async () => {
    const { projects, failures } = await get("/api/projects");
    expect(failures).toEqual([]);
    expect(projects).toEqual([
      {
        id: projectId(beta),
        path: beta,
        name: "beta",
        lastActivity: "2026-09-05T00:00:00.000Z",
        sessionCounts: { claude: 1 },
      },
      {
        id: projectId(alpha),
        path: alpha,
        name: "alpha",
        lastActivity: "2026-09-04T00:00:00.000Z",
        sessionCounts: { claude: 1, codex: 1 },
      },
    ]);
    const page = await get(`/api/projects/${projectId(alpha)}/sessions`);
    expect(
      page.sessions.map((s: { provider: string; id: string }) => `${s.provider}:${s.id}`),
    ).toEqual(["codex:x1", "claude:c1"]);
    expect(page.nextOffset).toBeNull();
  });

  it("lists folderless sessions apart, and leaves out those whose directory is gone", async () => {
    const page = await get("/api/projects/unassigned/sessions");
    expect(page.sessions).toMatchObject([{ provider: "codex", id: "x2", cwd: chat }]);
    expect(page.sessions[0]).not.toHaveProperty("projectId");
    const all = await get(`/api/projects/${projectId(alpha)}/sessions?provider=claude`);
    expect(all.sessions.map((s: { id: string }) => s.id)).toEqual(["c1"]);
  });

  it("pages through a project's sessions", async () => {
    const first = await get(`/api/projects/${projectId(alpha)}/sessions?limit=1`);
    expect(first.sessions).toHaveLength(1);
    expect(first.nextOffset).toBe(1);
    const second = await get(`/api/projects/${projectId(alpha)}/sessions?limit=1&offset=1`);
    expect(second.sessions.map((s: { id: string }) => s.id)).toEqual(["c1"]);
    expect(second.nextOffset).toBeNull();
  });

  it("adds a directory before any session ran there, and hides a project", async () => {
    const empty = join(root, "work", "empty");
    await mkdir(empty);
    const added = await server.app.request("/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ path: empty }),
    });
    expect(added.status).toBe(201);
    expect((await added.json()).data).toMatchObject({ path: empty, lastActivity: null });
    const refused = await server.app.request("/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ path: join(root, "work", "missing") }),
    });
    expect(refused.status).toBe(422);

    const hidden = await server.app.request(`/api/projects/${projectId(beta)}`, {
      method: "DELETE",
      headers,
    });
    expect(hidden.status).toBe(204);
    const { projects } = await get("/api/projects");
    expect(projects.map((project: { name: string }) => project.name)).toEqual(["alpha", "empty"]);
  });

  it("names a provider whose history cannot be read, and still lists the others", async () => {
    codex.listSessions = async () => {
      throw new Error("codex app-server failed");
    };
    server.catalog.invalidate();
    const { projects, failures } = await get("/api/projects");
    expect(failures).toEqual([{ provider: "codex", message: "codex app-server failed" }]);
    expect(projects.map((project: { name: string }) => project.name)).toEqual(["beta", "alpha"]);
  });

  it("pushes changes to open event streams until the page goes away", async () => {
    const controller = new AbortController();
    const response = await server.app.request("/api/events", { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no event stream");
    // The stream subscribes as it starts; publish until it has.
    const publishing = setInterval(() => server.events.publish({ type: "sessions" }), 10);
    try {
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toContain("event: sessions");
    } finally {
      clearInterval(publishing);
      controller.abort();
      await reader.cancel();
    }
  });
});
