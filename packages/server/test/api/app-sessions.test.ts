import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LibraryService } from "../../src/services/LibraryService.js";
import { SessionStore } from "../../src/sessions/SessionStore.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";

class TestLibrary extends LibraryService {
  override async request() {
    return Response.json({
      citations: [
        {
          id: "ref-1",
          paperId: "paper-1",
          chunkId: "c1",
          title: "Paper",
          startLine: 1,
          endLine: 3,
          text: "evidence",
        },
      ],
      truncated: false,
    });
  }
}
const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };
describe.each(["claude", "codex"] as const)("%s application sessions", (name) => {
  let root: string;
  let provider: WorkbenchProvider;
  let server: ReturnType<typeof createApp>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-sessions-"));
    provider = new WorkbenchProvider(name);
    server = createApp({ dataDir: root, provider, libraryService: new TestLibrary(root) });
    await server.ready;
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  async function create() {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name, paperIds: ["paper-1"] }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }
  const send = (id: string, text: string, messageId = crypto.randomUUID()) =>
    server.app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: messageId, text }),
    });
  it("persists canonical messages, sends only new input, and resumes by native ID", async () => {
    const id = await create();
    const first = await send(id, "第一问", "input1");
    expect(first.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const events = await first.text();
    expect(events).toContain("data-citations");
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const firstNative = server.sessions.store.get(id).nativeSessionId;
    expect(firstNative).toBeTruthy();
    expect(firstNative).not.toBe(id);
    expect(server.sessions.detail(id)).not.toHaveProperty("nativeSessionId");
    const duplicate = await send(id, "第一问", "input1");
    expect(duplicate.status).toBe(409);
    await (await send(id, "第二问")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls).toHaveLength(1);
    expect(provider.inputs[1]).toContain("第二问");
    expect(provider.inputs[1]).not.toContain("第一问");
    expect(server.sessions.detail(id).messages).toHaveLength(4);
    await server.close();
    server = createApp({ dataDir: root, provider, libraryService: new TestLibrary(root) });
    await server.ready;
    await (await send(id, "重启后继续")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls[1]?.resumeSessionId).toBe(firstNative);
    expect(server.sessions.detail(id).messages).toHaveLength(6);
  });
  it("keeps a run alive after disconnect, replays once, and interrupts the provider", async () => {
    const id = await create();
    const response = await send(id, "slow");
    await expect.poll(() => provider.inputs.length).toBe(1);
    await response.body?.cancel();
    expect(provider.interruptions).toBe(0);
    expect(server.sessions.detail(id).messages).toHaveLength(1);
    const resumed = await server.app.request(`/api/sessions/${id}/stream`);
    const stopped = await server.app.request(`/api/sessions/${id}/stop`, {
      method: "POST",
      headers,
    });
    expect(stopped.status).toBe(200);
    expect(provider.interruptions).toBe(1);
    const text = await resumed.text();
    expect(text.match(/"type":"start"/g)).toHaveLength(1);
    expect(text.match(/"type":"finish"/g)).toHaveLength(1);
  });
  it("preserves approvals and excludes external native sessions", async () => {
    const id = await create();
    const response = await send(id, "approval");
    await expect.poll(() => server.sessions.detail(id).pendingInput?.id).toBeTruthy();
    const pending = server.sessions.detail(id).pendingInput;
    expect(pending?.sessionId).toBe(id);
    const decision = await server.app.request(`/api/sessions/${id}/input`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "deny" }),
    });
    expect(decision.status).toBe(200);
    await response.text();
    expect(provider.approvals).toEqual(["deny"]);
    expect((await (await server.app.request("/api/sessions")).json()).sessions).toHaveLength(1);
    expect((await server.app.request("/api/projects")).status).toBe(404);
  });
  it("marks interrupted disk runs without replaying input", async () => {
    const record = await server.sessions.store.create({
      title: "interrupted",
      provider: name,
      paperIds: [],
    });
    record.state = "running";
    record.nativeSessionId = "native";
    await server.sessions.store.save(record);
    const restarted = new SessionStore(root);
    await restarted.initialize();
    expect(restarted.get(record.id).state).toBe("interrupted");
    expect(provider.calls).toHaveLength(0);
  });
});
