import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { SessionStore } from "../../src/sessions/SessionStore.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";
import { TEST_LIBRARY_URL } from "../helpers/library.js";

class TestLibrary extends LibraryClient {
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
    const skillsDir = join(root, "skills");
    await mkdir(join(skillsDir, "review-fixture"), { recursive: true });
    await writeFile(
      join(skillsDir, "review-fixture", "SKILL.md"),
      "---\nname: review-fixture\ndescription: Test research skill\n---\nRESEARCH_SKILL_INSTRUCTIONS $ARGUMENTS",
    );
    provider = new WorkbenchProvider(name);
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
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
  it("uploads session-owned files, rejects foreign attachments and retains file parts after restart", async () => {
    const id = await create();
    const foreign = await create();
    const form = new FormData();
    form.set("file", new File(["paper attachment"], "研究资料.pdf", { type: "application/pdf" }));
    const upload = await server.app.request(`/api/sessions/${id}/attachments`, {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const attachment = await upload.json();
    expect(attachment).not.toHaveProperty("path");
    expect((await server.app.request(attachment.url)).headers.get("content-disposition")).toContain(
      "attachment;",
    );
    const post = (sessionId: string) =>
      server.app.request(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "attached", text: "", attachmentIds: [attachment.id] }),
      });
    expect((await post(foreign)).status).toBe(400);
    expect(provider.calls).toHaveLength(0);
    await (await post(id)).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.inputs[0]).toContain("研究资料.pdf");
    const uploaded = provider.calls[0]?.initialMessage?.attachments?.[0];
    expect(uploaded?.path).toContain(`/sessions/${id}/workspace/.attachments/`);
    expect(await readFile(uploaded?.path ?? "", "utf8")).toBe("paper attachment");
    expect(server.sessions.detail(id).messages[0]?.parts).toEqual([
      expect.objectContaining({ type: "file", filename: "研究资料.pdf", url: attachment.url }),
    ]);
    await server.close();
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
    await server.ready;
    expect(await (await server.app.request(attachment.url)).text()).toBe("paper attachment");
    await unlink(uploaded?.path ?? "");
    await symlink(join(root, "sessions", id, "session.json"), uploaded?.path ?? "");
    expect((await server.app.request(attachment.url)).status).toBe(400);
  });

  it("keeps the worker when a stopped turn settles, so the next message reuses it", async () => {
    const id = await create();
    const running = await send(id, "slow");
    await expect.poll(() => server.sessions.detail(id).state).toBe("running");
    await server.sessions.stop(id);
    await running.text();
    expect(provider.interruptions).toBe(1);
    await (await send(id, "next")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls).toHaveLength(1);
    expect(provider.inputs.at(-1)).toContain("next");
  });

  it("runs durable queued messages in order once, and pauses them across stop and restart", async () => {
    const id = await create();
    const active = await send(id, "approval");
    await expect.poll(() => server.sessions.detail(id).pendingInput?.id).toBeTruthy();
    const enqueue = (messageId: string, text: string) =>
      server.app.request(`/api/sessions/${id}/queue`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: messageId, text }),
      });
    expect((await enqueue("q1", "second")).status).toBe(200);
    await enqueue("q1", "second");
    await enqueue("q2", "third");
    expect(server.sessions.detail(id).queuedMessages).toHaveLength(2);
    const request = server.sessions.detail(id).pendingInput;
    server.sessions.input(id, request?.id ?? "", "deny");
    await active.text();
    await expect.poll(() => provider.inputs.length).toBe(3);
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.inputs[1]).toContain("second");
    expect(provider.inputs[2]).toContain("third");
    expect(server.sessions.detail(id).queuedMessages).toEqual([]);
    const stopped = await send(id, "slow");
    await enqueue("q3", "after restart");
    await server.sessions.stop(id);
    await stopped.text();
    expect(server.sessions.detail(id).queuePaused).toBe(true);
    await server.close();
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
    await server.ready;
    expect(server.sessions.detail(id).queuedMessages).toHaveLength(1);
    expect(server.sessions.detail(id).queuePaused).toBe(true);
    await server.sessions.editQueue(id, "resume");
    await expect
      .poll(() => provider.inputs.some((text) => text.includes("after restart")))
      .toBe(true);
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
  });

  it("activates only the selected research skill and confines the file tree to the session", async () => {
    const id = await create();
    const workspace = join(root, "sessions", id, "workspace");
    await writeFile(join(workspace, "result.md"), "# 真实输出\n文件内容");
    await writeFile(join(root, "outside.txt"), "private");
    await symlink(join(root, "outside.txt"), join(workspace, "outside-link"));
    const tree = await server.app.request(`/api/sessions/${id}/fs/browse`);
    expect((await tree.json()).entries.map((entry: { name: string }) => entry.name)).toEqual([
      "result.md",
    ]);
    const preview = await server.app.request(`/api/sessions/${id}/fs/file?path=result.md`);
    expect((await preview.json()).content).toContain("真实输出");
    for (const path of ["../session.json", "outside-link", join(root, "outside.txt")]) {
      expect(
        (await server.app.request(`/api/sessions/${id}/fs/file?path=${encodeURIComponent(path)}`))
          .status,
      ).toBe(400);
    }
    await (await send(id, "/review-fixture 分析论文")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.inputs[0]).toContain("RESEARCH_SKILL_INSTRUCTIONS 分析论文");
    expect(server.sessions.detail(id).messages[0]?.parts).toEqual([
      { type: "text", text: "/review-fixture 分析论文" },
    ]);
    await (await send(id, "普通问题")).text();
    expect(provider.inputs[1]).not.toContain("RESEARCH_SKILL_INSTRUCTIONS");
  });

  it("applies original execution controls and resumes with a changed model", async () => {
    const id = await create();
    const options = (value: object) =>
      server.app.request(`/api/sessions/${id}/options`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(value),
      });
    expect(
      (
        await options({
          model: "first-model",
          permissionMode: "plan",
          thinking: "adaptive",
          effort: "high",
        })
      ).status,
    ).toBe(200);
    await (await send(id, "first")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls[0]).toMatchObject({
      model: "first-model",
      permissionMode: "plan",
      thinking: { type: "adaptive" },
      effort: "high",
    });
    expect((await options({ model: "second-model", permissionMode: "default" })).status).toBe(200);
    await (await send(id, "second")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls.at(-1)).toMatchObject({
      model: "second-model",
      permissionMode: "default",
    });
    expect(server.sessions.detail(id).messages).toHaveLength(4);
    const running = await send(id, "approval slow");
    await expect.poll(() => server.sessions.detail(id).state).toBe("waiting-input");
    const callsBefore = provider.calls.length;
    const changed = await options({ model: "during-run", permissionMode: "plan" });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      model: "during-run",
      pendingOptions: ["model", "permissionMode"],
    });
    // The running turn keeps the process it started with.
    expect(provider.calls).toHaveLength(callsBefore);
    await server.sessions.stop(id);
    await running.text();
    await (await send(id, "third")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls.at(-1)).toMatchObject({ model: "during-run", permissionMode: "plan" });
    expect(server.sessions.detail(id).pendingOptions).toBeUndefined();
  });

  it("lets a new chat upload before its session exists and claims the files on create", async () => {
    const form = new FormData();
    form.set("file", new File(["draft notes"], "草稿.txt", { type: "text/plain" }));
    const upload = await server.app.request("/api/sessions/draft-attachments", {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const draft = await upload.json();
    expect(draft.url).toBe(`/api/sessions/draft-attachments/${draft.id}`);

    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name, paperIds: [], attachmentIds: [draft.id] }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session).not.toHaveProperty("attachmentIds");
    const read = await server.app.request(`/api/sessions/${session.id}/attachments/${draft.id}`, {
      headers,
    });
    expect(await read.text()).toBe("draft notes");
    // A claimed draft is gone from the draft area.
    const again = await server.app.request(`/api/sessions/draft-attachments/${draft.id}`, {
      method: "DELETE",
      headers,
    });
    expect(again.status).toBe(400);

    await (
      await server.app.request(`/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          text: "看附件",
          attachmentIds: [draft.id],
        }),
      })
    ).text();
    await expect.poll(() => server.sessions.detail(session.id).state).toBe("idle");
    expect(provider.calls.at(-1)?.initialMessage?.attachments?.[0]?.originalName).toBe("草稿.txt");
  });

  it("removes an unsent attachment but keeps one a message refers to", async () => {
    const id = await create();
    const upload = async (text: string) => {
      const form = new FormData();
      form.set("file", new File([text], `${text}.txt`, { type: "text/plain" }));
      const response = await server.app.request(`/api/sessions/${id}/attachments`, {
        method: "POST",
        headers: { "ScholarAIO-Hub": "true" },
        body: form,
      });
      return (await response.json()).id as string;
    };
    const unsent = await upload("unsent");
    const sent = await upload("sent");
    const remove = (attachmentId: string) =>
      server.app.request(`/api/sessions/${id}/attachments/${attachmentId}`, {
        method: "DELETE",
        headers,
      });
    expect((await remove(unsent)).status).toBe(204);
    expect(
      (await server.app.request(`/api/sessions/${id}/attachments/${unsent}`, { headers })).status,
    ).toBe(400);
    await (
      await server.app.request(`/api/sessions/${id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: crypto.randomUUID(), text: "带附件", attachmentIds: [sent] }),
      })
    ).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect((await remove(sent)).status).toBe(400);
  });

  it("sweeps draft uploads nobody claimed within a day", async () => {
    const draft = await server.sessions.attachments.uploadDraft(
      new File(["old"], "old.txt", { type: "text/plain" }),
    );
    await server.sessions.attachments.sweepDrafts(Date.now() + 25 * 60 * 60 * 1000);
    await expect(server.sessions.attachments.removeDraft(draft.id)).rejects.toThrow("已被移除");
  });

  it("lists the provider's own commands for the workspace, then research skills", async () => {
    provider.commands = [
      {
        name: "compact",
        description: "Compact",
        source: "provider",
        trigger: "/",
        position: "leading",
      },
      {
        name: "review-fixture",
        description: "Provider skill",
        source: "provider",
        trigger: "$",
        position: "anywhere",
      },
    ];
    const id = await create();
    const response = await server.app.request(`/api/sessions/${id}/commands`, { headers });
    expect(response.status).toBe(200);
    const { commands } = await response.json();
    expect(commands).toEqual([
      ...provider.commands,
      {
        name: "review-fixture",
        description: "Test research skill",
        source: "research",
        trigger: "/",
        position: "leading",
      },
    ]);
    expect(provider.commandCwds.at(-1)).toBe(join(root, "sessions", id, "workspace"));
    const draft = await server.app.request(`/api/sessions/commands?provider=${name}`, { headers });
    expect(draft.status).toBe(200);
    expect(provider.commandCwds.at(-1)).toBe(join(root, "draft-workspace"));
  });

  it("runs the next turn when a changed effort makes the supervisor replace the process", async () => {
    const id = await create();
    await (await send(id, "first")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const options = await server.app.request(`/api/sessions/${id}/options`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ thinking: "adaptive", effort: "high" }),
    });
    expect(options.status).toBe(200);
    await (await send(id, "second")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const detail = server.sessions.detail(id);
    expect(detail.error).toBeUndefined();
    expect(provider.calls.at(-1)).toMatchObject({ effort: "high" });
    expect(detail.messages).toHaveLength(4);
  });

  it("accepts only efforts the chosen model offers", async () => {
    provider.models = [
      { id: "fast", name: "Fast", isDefault: true, efforts: [{ id: "low" }] },
      { id: "deep", name: "Deep", efforts: [{ id: "low" }, { id: "xhigh" }] },
    ];
    const id = await create();
    const options = (value: object) =>
      server.app.request(`/api/sessions/${id}/options`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(value),
      });
    expect((await options({ effort: "xhigh" })).status).toBe(400);
    expect((await options({ model: "deep", effort: "xhigh" })).status).toBe(200);
    expect((await options({ model: "fast" })).status).toBe(400);
    expect((await options({ effort: "" })).status).toBe(200);
    expect(server.sessions.detail(id).effort).toBeUndefined();
    expect((await options({ thinking: "on:high" })).status).toBe(400);
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name, paperIds: [], effort: "xhigh" }),
    });
    expect(created.status).toBe(400);
  });

  it("reads the combined thinking value of sessions stored before effort was separate", async () => {
    const id = await create();
    const record = server.sessions.store.get(id);
    await server.close();
    const file = join(root, "sessions", id, "session.json");
    await writeFile(file, JSON.stringify({ ...record, thinking: "on:max" }));
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
    await server.ready;
    expect(server.sessions.detail(id)).toMatchObject({ thinking: "adaptive", effort: "max" });
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
    expect(server.sessions.detail(id).messages[1]?.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    const duplicate = await send(id, "第一问", "input1");
    expect(duplicate.status).toBe(409);
    await (await send(id, "第二问")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls).toHaveLength(1);
    expect(provider.inputs[1]).toContain("第二问");
    expect(provider.inputs[1]).not.toContain("第一问");
    expect(server.sessions.detail(id).messages).toHaveLength(4);
    await server.close();
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
    await server.ready;
    await (await send(id, "重启后继续")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls[1]?.resumeSessionId).toBe(firstNative);
    expect(server.sessions.detail(id).messages).toHaveLength(6);
  });
  it("forks through a turn into a new session that resumes a native fork in the same directory", async () => {
    const id = await create();
    await (await send(id, "第一问", "u1")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    await (await send(id, "第二问", "u2")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const response = await server.app.request(`/api/sessions/${id}/fork`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messageId: "u1" }),
    });
    expect(response.status).toBe(201);
    const fork = await response.json();
    expect(fork.id).not.toBe(id);
    expect(fork).not.toHaveProperty("nativeSessionId");
    expect(fork.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(provider.forks).toEqual([
      expect.objectContaining({
        sessionId: server.sessions.store.get(id).nativeSessionId,
        dropTurns: 1,
        cwd: join(root, "sessions", id, "workspace"),
      }),
    ]);
    expect(server.sessions.detail(id).messages).toHaveLength(4);
    await (await send(fork.id, "分叉后继续")).text();
    await expect.poll(() => server.sessions.detail(fork.id).state).toBe("idle");
    expect(provider.calls.at(-1)?.resumeSessionId).toBe(provider.forks[0]?.forkedId);
    expect(provider.calls.at(-1)?.cwd).toBe(join(root, "sessions", id, "workspace"));
  });

  it("rewinds to before a turn so an edited prompt replaces it", async () => {
    const id = await create();
    await (await send(id, "第一问", "u1")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    await (await send(id, "第二问", "u2")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const rewind = (messageId: string) =>
      server.app.request(`/api/sessions/${id}/rewind`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messageId }),
      });
    expect((await rewind("u2")).status).toBe(200);
    expect(server.sessions.detail(id).messages).toHaveLength(2);
    expect(provider.forks.at(-1)?.dropTurns).toBe(1);
    await (await send(id, "改过的第二问", "u2-edited")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls.at(-1)?.resumeSessionId).toBe(provider.forks.at(-1)?.forkedId);
    expect(provider.inputs.at(-1)).toContain("改过的第二问");

    // Nothing is left before the first turn: the next one starts a fresh native session.
    expect((await rewind("u1")).status).toBe(200);
    expect(server.sessions.detail(id).messages).toEqual([]);
    expect(provider.forks).toHaveLength(1);
    await (await send(id, "重新开始")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(provider.calls.at(-1)?.resumeSessionId).toBeUndefined();
    expect((await rewind("missing")).status).toBe(409);
  });

  it("renames, forks whole and deletes a session, keeping a workspace its fork still uses", async () => {
    const id = await create();
    await (await send(id, "第一问", "u1")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    const rename = await server.app.request(`/api/sessions/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "  新标题 " }),
    });
    expect((await rename.json()).title).toBe("新标题");
    const forked = await server.app.request(`/api/sessions/${id}/fork`, {
      method: "POST",
      headers,
    });
    expect(forked.status).toBe(201);
    const fork = await forked.json();
    expect(fork.messages).toHaveLength(2);
    expect(provider.forks.at(-1)?.dropTurns).toBe(0);

    expect(
      (await server.app.request(`/api/sessions/${id}`, { method: "DELETE", headers })).status,
    ).toBe(204);
    expect((await server.app.request(`/api/sessions/${id}`)).status).toBe(404);
    // The fork works in the deleted session's directory, so the directory stays.
    await expect(readFile(join(root, "sessions", id, "session.json"))).rejects.toThrow();
    await mkdir(join(root, "sessions", id, "workspace"), { recursive: false }).catch((error) =>
      expect(error.code).toBe("EEXIST"),
    );
    await server.close();
    server = createApp({
      dataDir: root,
      provider,
      library: new TestLibrary(TEST_LIBRARY_URL),
      scholaraioSkillsDir: join(root, "skills"),
    });
    await server.ready;
    expect(server.sessions.detail(fork.id).messages).toHaveLength(2);
    expect(
      (await server.app.request(`/api/sessions/${fork.id}`, { method: "DELETE", headers })).status,
    ).toBe(204);
    await expect(readFile(join(root, "sessions", fork.id, "session.json"))).rejects.toThrow();
  });

  it("gives a chat without a workspace or papers no library passages", async () => {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name }),
    });
    const id = (await response.json()).id as string;
    const events = await (await send(id, "你好")).text();
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");
    expect(events).not.toContain("data-citations");
    expect(provider.inputs[0]).not.toContain("library_context");
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
  it("pushes the pending decision to the open stream without storing it", async () => {
    const id = await create();
    const response = await send(id, "approval");
    await expect.poll(() => server.sessions.detail(id).pendingInput?.id).toBeTruthy();
    const pending = server.sessions.detail(id).pendingInput;
    await server.app.request(`/api/sessions/${id}/input`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "deny" }),
    });
    const text = await response.text();
    expect(text).toContain('"type":"data-session-state"');
    expect(text).toContain('"state":"waiting-input"');
    expect(text).toContain(`"id":"${pending?.id}"`);
    const stored = server.sessions.detail(id).messages.flatMap((message) => message.parts);
    expect(stored.some((part) => part.type === "data-session-state")).toBe(false);
  });
  it("approves and switches to accept-edits like the original approval panel", async () => {
    const id = await create();
    const response = await send(id, "approval");
    await expect.poll(() => server.sessions.detail(id).pendingInput?.id).toBeTruthy();
    const pending = server.sessions.detail(id).pendingInput;
    const decision = await server.app.request(`/api/sessions/${id}/input`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "approve_accept_edits" }),
    });
    expect(decision.status).toBe(200);
    await response.text();
    expect(provider.approvals).toEqual(["allow"]);
    expect(server.sessions.detail(id).permissionMode).toBe("acceptEdits");
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

describe("workbench project and settings contract", () => {
  it("browses the project directory the agent works in, not the private workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-project-files-"));
    const projectDir = join(root, "projects", "p1");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "notes.md"), "# 项目笔记");
    class ProjectLibrary extends LibraryClient {
      override async request(resource: string) {
        if (resource === "/projects/p1")
          return Response.json({ id: "p1", name: "P1", path: projectDir, paperIds: [] });
        return Response.json({ paperIds: [] });
      }
    }
    const server = createApp({
      dataDir: root,
      provider: new WorkbenchProvider("claude"),
      library: new ProjectLibrary(TEST_LIBRARY_URL),
    });
    try {
      await server.ready;
      const created = await server.app.request("/api/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: "claude", projectId: "p1" }),
      });
      const { id } = await created.json();
      const tree = await server.app.request(`/api/sessions/${id}/fs/browse`);
      expect((await tree.json()).entries.map((entry: { name: string }) => entry.name)).toEqual([
        "notes.md",
      ]);
      const preview = await server.app.request(`/api/sessions/${id}/fs/file?path=notes.md`);
      expect(await preview.json()).toMatchObject({ content: "# 项目笔记", truncated: false });
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists project identity, enforces scope, and applies provider-specific defaults", async () => {
    const { ServerSettingsService } = await import("../../src/services/ServerSettingsService.js");
    const root = await mkdtemp(join(tmpdir(), "hub-project-contract-"));
    const calls: { resource: string; input: Record<string, unknown> }[] = [];
    class ScopedLibrary extends LibraryClient {
      override async request(resource: string, init?: RequestInit) {
        const input = JSON.parse(String(init?.body ?? "{}"));
        calls.push({ resource, input });
        if (input.projectId === "outside")
          return Response.json({ error: "invalid project" }, { status: 400 });
        return Response.json(
          resource === "/scope" ? { paperIds: [] } : { citations: [], truncated: false },
        );
      }
    }
    const settings = new ServerSettingsService({ dataDir: root });
    await settings.initialize();
    await settings.updateSettings({
      newSessionDefaults: { provider: "codex", model: "codex-model" },
    });
    const server = createApp({
      dataDir: root,
      provider: new WorkbenchProvider("codex"),
      library: new ScopedLibrary(TEST_LIBRARY_URL),
      serverSettingsService: settings,
    });
    try {
      await server.ready;
      const create = (body: object) =>
        server.app.request("/api/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      const response = await create({ projectId: "内部项目" });
      expect(response.status).toBe(201);
      const session = await response.json();
      expect(session).toMatchObject({
        projectId: "内部项目",
        provider: "codex",
        model: "codex-model",
        paperIds: [],
      });
      const turn = await server.app.request(`/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "first", text: "summarize" }),
      });
      await turn.text();
      expect(calls).toContainEqual({
        resource: "/context",
        input: { query: "summarize", paperIds: [], projectId: "内部项目" },
      });
      expect((await create({ projectId: "outside" })).status).toBe(400);
      expect(await (await create({ provider: "claude" })).json()).not.toHaveProperty("model");
      expect(await (await create({ model: "" })).json()).not.toHaveProperty("model");
      await settings.updateSettings({ newSessionDefaults: { provider: "claude" } });
      expect(server.sessions.detail(session.id).provider).toBe("codex");
      const restored = new SessionStore(root);
      await restored.initialize();
      expect(restored.toStoredSession(restored.get(session.id))).toMatchObject({
        projectId: "内部项目",
        provider: "codex",
      });
      expect(restored.list().some((s) => !s.projectId)).toBe(true);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
