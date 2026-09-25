import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LibraryService } from "../../src/services/LibraryService.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

/** Records what the library service was asked to do. */
class RecordingLibrary extends LibraryService {
  readonly calls: string[] = [];
  override async request(resource: string, init: RequestInit = {}) {
    this.calls.push(`${init.method ?? "GET"} ${resource}`);
    if (resource.includes("/rename"))
      return Response.json({ id: "survey", name: "survey", paperIds: [], paperCount: 0 });
    if (init.method === "DELETE") return Response.json({ id: "review", archivedAt: "now" });
    if (resource.startsWith("/projects/"))
      return Response.json({
        id: "review",
        name: "review",
        path: join(this.dataDir, "workspace", "review"),
        paperIds: [],
        paperCount: 0,
      });
    return Response.json({ citations: [], truncated: false });
  }
}

describe("project routes", () => {
  let root: string;
  let server: ReturnType<typeof createApp>;
  let library: RecordingLibrary;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-library-projects-"));
    library = new RecordingLibrary(root);
    server = createApp({
      dataDir: root,
      provider: new WorkbenchProvider(),
      libraryService: library,
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  async function session(projectId?: string) {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "claude", paperIds: [], projectId }),
    });
    return (await response.json()).id as string;
  }

  it("moves a renamed project's sessions with it", async () => {
    const inProject = await session("review");
    const elsewhere = await session();

    const response = await server.app.request("/api/library/projects/review/rename", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "survey" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: 1 });
    expect(server.sessions.detail(inProject).projectId).toBe("survey");
    expect(server.sessions.detail(elsewhere).projectId).toBeUndefined();
  });

  it("detaches sessions from an archived project instead of losing them", async () => {
    const id = await session("review");

    const response = await server.app.request("/api/library/projects/review", {
      method: "DELETE",
      headers,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: 1 });
    expect(server.sessions.detail(id).projectId).toBeUndefined();
    expect(library.calls).toContain("DELETE /projects/review");
  });

  it("refuses a rename with no name before asking the library", async () => {
    const response = await server.app.request("/api/library/projects/review/rename", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "  " }),
    });

    expect(response.status).toBe(400);
    expect(library.calls.filter((call) => call.includes("/rename"))).toEqual([]);
  });
});
