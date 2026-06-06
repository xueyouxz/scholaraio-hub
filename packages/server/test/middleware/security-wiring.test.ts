import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ProjectMetadataService } from "../../src/metadata/index.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";

/**
 * Integration tests proving the security middleware is actually mounted in
 * createApp (not just that the underlying functions work in isolation).
 *
 * - hostCheckMiddleware guards /api/* and /hub/fs against DNS rebinding.
 * - requireCustomHeader guards mutating /api/* requests against CSRF.
 * - /health is exempt.
 * - GET requests are exempt from the custom-header requirement.
 */
describe("security middleware wiring", () => {
  let rootDir: string;
  let projectsDir: string;
  let addedProjectPath: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "security-wiring-"));
    projectsDir = join(rootDir, "claude-projects");
    addedProjectPath = join(rootDir, "workspace");
    await mkdir(projectsDir, { recursive: true });
    await mkdir(addedProjectPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function makeApp() {
    return createApp({ projectsDir, sdk: new MockClaudeSDK() }).app;
  }

  it("rejects /api requests with a disallowed Host header (DNS rebinding)", async () => {
    const res = await makeApp().request("/api/version", {
      headers: { host: "evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects /hub/fs requests with a disallowed Host header", async () => {
    const res = await makeApp().request("/hub/fs/browse?path=/tmp", {
      headers: { host: "evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("exempts /health from the Host check", async () => {
    const res = await makeApp().request("/health", {
      headers: { host: "evil.com" },
    });
    expect(res.status).not.toBe(403);
  });

  it("allows /api requests from an allowed Host", async () => {
    const res = await makeApp().request("/api/version", {
      headers: { host: "localhost:3400" },
    });
    expect(res.status).not.toBe(403);
  });

  it("rejects mutating /api requests missing the custom header (CSRF)", async () => {
    const res = await makeApp().request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: addedProjectPath }),
    });
    expect(res.status).toBe(403);
  });

  it("allows mutating /api requests carrying the custom header", async () => {
    const projectMetadataService = new ProjectMetadataService({
      dataDir: join(rootDir, "data"),
    });
    await projectMetadataService.initialize();

    const app = createApp({
      projectsDir,
      projectMetadataService,
      sdk: new MockClaudeSDK(),
    }).app;

    const res = await app.request("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ScholarAIO-Hub": "true",
      },
      body: JSON.stringify({ path: addedProjectPath }),
    });
    expect(res.status).not.toBe(403);
  });

  it("exempts GET /api requests from the custom-header requirement", async () => {
    const res = await makeApp().request("/api/version");
    expect(res.status).not.toBe(403);
  });
});
