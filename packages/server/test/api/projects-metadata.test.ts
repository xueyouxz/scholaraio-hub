import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ProjectMetadataService } from "../../src/metadata/index.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";

describe("Projects metadata integration", () => {
  let rootDir: string;
  let dataDir: string;
  let projectsDir: string;
  let addedProjectPath: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "projects-meta-"));
    dataDir = join(rootDir, "data");
    projectsDir = join(rootDir, "claude-projects");
    addedProjectPath = join(rootDir, "workspace");
    await mkdir(projectsDir, { recursive: true });
    await mkdir(addedProjectPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("persists manually added projects", async () => {
    const projectMetadataService = new ProjectMetadataService({ dataDir });
    await projectMetadataService.initialize();

    const { app } = createApp({
      projectsDir,
      projectMetadataService,
      sdk: new MockClaudeSDK(),
    });

    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: addedProjectPath }),
    });

    expect(res.status).toBe(200);

    const content = await readFile(projectMetadataService.getFilePath(), "utf-8");
    expect(content).toContain(addedProjectPath);
  });
});
