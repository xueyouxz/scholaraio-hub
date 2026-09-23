import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LibraryService } from "../../src/services/LibraryService.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

/** A library whose project "review" is a real directory on disk. */
class ProjectLibrary extends LibraryService {
  constructor(
    dataDir: string,
    readonly projectPath: string,
  ) {
    super(dataDir);
  }
  override async request(resource: string) {
    if (resource.startsWith("/projects/"))
      return Response.json({
        id: "review",
        name: "review",
        path: this.projectPath,
        paperIds: ["paper-1"],
        paperCount: 1,
      });
    if (resource.startsWith("/scope")) return Response.json({ paperIds: ["paper-1"] });
    return Response.json({ citations: [], truncated: false });
  }
}

describe("sessions in a literature project", () => {
  let root: string;
  let projectPath: string;
  let provider: WorkbenchProvider;
  let server: ReturnType<typeof createApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-project-sessions-"));
    projectPath = join(root, "workspace", "review");
    await mkdir(projectPath, { recursive: true });
    provider = new WorkbenchProvider("claude");
    server = createApp({
      dataDir: root,
      provider,
      libraryService: new ProjectLibrary(root, projectPath),
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  async function create(projectId?: string) {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "claude", paperIds: [], projectId }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  const send = (id: string, text: string) =>
    server.app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: crypto.randomUUID(), text }),
    });

  it("runs the agent in the project directory, and several sessions share it", async () => {
    const first = await create("review");
    const second = await create("review");

    await (await send(first, "第一个问题")).text();
    await expect.poll(() => server.sessions.detail(first).state).toBe("idle");
    await (await send(second, "第二个问题")).text();
    await expect.poll(() => server.sessions.detail(second).state).toBe("idle");

    expect(provider.calls.map((call) => call.cwd)).toEqual([projectPath, projectPath]);
    // Each session kept its own transcript although they share a directory.
    expect(server.sessions.detail(first).messages).toHaveLength(2);
    expect(server.sessions.detail(second).messages).toHaveLength(2);
    expect(JSON.stringify(server.sessions.detail(first).messages)).toContain("第一个问题");
    expect(JSON.stringify(server.sessions.detail(first).messages)).not.toContain("第二个问题");
  });

  it("keeps a session without a project in its own directory", async () => {
    const id = await create();
    await (await send(id, "没有项目")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");

    expect(provider.calls[0]?.cwd).toBe(join(root, "sessions", id, "workspace"));
  });
});
