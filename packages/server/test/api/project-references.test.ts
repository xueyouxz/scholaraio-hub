import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER } from "@scholaraio-hub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";
import { TEST_LIBRARY_URL } from "../helpers/library.js";

const headers = { "content-type": "application/json", [CSRF_HEADER.name]: CSRF_HEADER.value };
const REVIEW_ID = "3f2b7c1e-0000-4000-8000-000000000001";

/**
 * A library with one project, "review", which it finds by id or by name, as
 * the library service does; "survey" is a project that was archived.
 */
class ProjectLibrary extends LibraryClient {
  constructor(readonly projectPath: string) {
    super(TEST_LIBRARY_URL);
  }
  override async request(resource: string) {
    const review = {
      id: REVIEW_ID,
      name: "review",
      path: this.projectPath,
      paperIds: [],
      paperCount: 0,
    };
    if (resource === "/projects") return Response.json({ projects: [review] });
    if (resource === `/projects/${REVIEW_ID}` || resource === "/projects/review")
      return Response.json(review);
    if (resource.startsWith("/projects/"))
      return Response.json({ error: "文献项目不存在" }, { status: 404 });
    if (resource.startsWith("/scope")) return Response.json({ paperIds: [] });
    return Response.json({ citations: [], truncated: false });
  }
}

describe("a session's project reference", () => {
  let root: string;
  let projectPath: string;
  let server: ReturnType<typeof createApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-project-references-"));
    projectPath = join(root, "workspace", "review");
    await mkdir(projectPath, { recursive: true });
    server = createApp({
      dataDir: root,
      provider: new WorkbenchProvider("claude"),
      library: new ProjectLibrary(projectPath),
    });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  async function create(projectId: string) {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "claude", paperIds: [], projectId }),
    });
    return (await response.json()).id as string;
  }

  it("moves from the project's name to its id when the session uses it", async () => {
    const id = await create("review");
    expect(await server.sessions.workingDirectory(id)).toBe(projectPath);
    expect(server.sessions.detail(id).projectId).toBe(REVIEW_ID);
  });

  it("continues in its own workspace once the project is gone", async () => {
    const id = await create("survey");
    expect(await server.sessions.workingDirectory(id)).toBe(
      join(root, "sessions", id, "workspace"),
    );
    expect(server.sessions.detail(id).projectId).toBeUndefined();
  });

  it("is brought up to the library's projects all at once", async () => {
    const byName = await create("review");
    const byId = await create(REVIEW_ID);
    const archived = await create("survey");

    expect(await server.sessions.reconcileProjects()).toBe(2);
    expect(server.sessions.detail(byName).projectId).toBe(REVIEW_ID);
    expect(server.sessions.detail(byId).projectId).toBe(REVIEW_ID);
    expect(server.sessions.detail(archived).projectId).toBeUndefined();
  });
});
