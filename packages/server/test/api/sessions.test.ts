import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionDetail } from "@scholaraio-hub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { DirectoryRules } from "../../src/projects/directories.js";
import { SessionStore } from "../../src/sessions/SessionStore.js";
import { WorkbenchProvider } from "../helpers/WorkbenchProvider.js";
import { createTestApp } from "../helpers/app.js";
import { libraryResponse } from "../helpers/library.js";
import { TEST_LIBRARY_URL } from "../helpers/library.js";

/** A library that finds one passage for any question, and records what it was asked. */
class TestLibrary extends LibraryClient {
  readonly asked: Array<{ resource: string; body: { collectionIds?: string[] } | null }> = [];
  override async request(resource: string, init?: RequestInit) {
    this.asked.push({ resource, body: JSON.parse(String(init?.body ?? "null")) });
    if (resource === "/collections")
      return libraryResponse({
        collections: [{ id: "综述", name: "综述集合", paperIds: ["paper-1"], paperCount: 1 }],
      });
    return libraryResponse({
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
const PAPER = { kind: "paper", id: "paper-1" } as const;

describe.each(["claude", "codex"] as const)("%s sessions", (name) => {
  let root: string;
  let project: string;
  let provider: WorkbenchProvider;
  let library: TestLibrary;
  let server: ReturnType<typeof createTestApp>;
  let dataDir: string;
  const start = () => {
    server = createTestApp({
      dataDir,
      provider,
      library,
      scholaraioSkillsDir: join(root, "skills"),
      // The test's directories are temporary ones; here they count as projects.
      directories: new DirectoryRules({ home: join(root, "home"), dataDir, temporary: [] }),
    });
    return server.ready;
  };
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "hub-sessions-")));
    project = join(root, "project");
    dataDir = join(root, "data");
    await mkdir(project);
    await mkdir(dataDir);
    const skillsDir = join(root, "skills");
    await mkdir(join(skillsDir, "review-fixture"), { recursive: true });
    await writeFile(
      join(skillsDir, "review-fixture", "SKILL.md"),
      "---\nname: review-fixture\ndescription: Test research skill\n---\nRESEARCH_SKILL_INSTRUCTIONS $ARGUMENTS",
    );
    provider = new WorkbenchProvider(name);
    library = new TestLibrary(TEST_LIBRARY_URL);
    await start();
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const url = (id: string, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
  const detail = (id: string) => server.sessions.detail(id);
  const state = async (id: string) => (await detail(id)).state;
  const idle = (id: string) => expect.poll(() => state(id)).toBe("idle");
  /** A session in the project, started with its first message; resolves once the provider named it. */
  async function create(
    text = "第一问",
    messageId: string = crypto.randomUUID(),
    fields: object = {},
  ): Promise<string> {
    const response = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: name,
        cwd: project,
        references: [PAPER],
        message: { id: messageId, text },
        ...fields,
      }),
    });
    expect(response.status).toBe(201);
    const session = (await response.json()).data as SessionDetail;
    return session.id;
  }
  const send = (id: string, text: string, messageId: string = crypto.randomUUID()) =>
    server.app.request(url(id, "/messages"), {
      method: "POST",
      headers,
      body: JSON.stringify({ id: messageId, text }),
    });

  it("names a new session by its provider's id and runs its first message at once", async () => {
    const id = await create("第一问", "input1");
    const nativeId = [...provider.kept.keys()][0];
    expect(id).toBe(`${name}:${nativeId}`);
    await idle(id);
    expect(provider.calls[0]).toMatchObject({ cwd: project });
    expect(provider.inputs[0]).toContain("<library_context>");
    const session = await detail(id);
    expect(session).toMatchObject({
      id,
      provider: name,
      nativeId,
      cwd: project,
      references: [PAPER],
      state: "idle",
    });
    // The transcript is the provider's; the prompt shows as the user wrote it.
    expect(session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(session.messages[0]).toMatchObject({
      id: "input1",
      parts: [{ type: "text", text: "第一问" }],
    });
    expect(session.messages[1]?.parts).toContainEqual(
      expect.objectContaining({ type: "data-citations" }),
    );
    expect(session.messages[1]?.metadata?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends only the new input, refuses a message twice, and resumes by the provider's id after a restart", async () => {
    const id = await create("第一问", "input1");
    await idle(id);
    expect((await send(id, "第一问", "input1")).status).toBe(409);
    await (await send(id, "第二问")).text();
    await idle(id);
    expect(provider.calls).toHaveLength(1);
    expect(provider.inputs[1]).toContain("第二问");
    expect(provider.inputs[1]).not.toContain("第一问");
    expect((await detail(id)).messages).toHaveLength(4);
    await server.close();
    await start();
    await (await send(id, "重启后继续")).text();
    await idle(id);
    expect(provider.calls[1]?.resumeSessionId).toBe((await detail(id)).nativeId);
    expect((await detail(id)).messages).toHaveLength(6);
  });

  it("opens and continues a session the provider ran without the Hub", async () => {
    const outside = crypto.randomUUID();
    provider.stored = [
      {
        id: outside,
        cwd: project,
        title: "终端里的会话",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ];
    provider.transcripts.set(outside, [
      {
        id: "p1",
        prompt: "终端里问的\n\n<library_context>\nold\n</library_context>",
        events: [
          { type: "text.delta", blockId: "b1", delta: "终端里答的" },
          { type: "turn.completed" },
        ],
      },
    ]);
    const id = `${name}:${outside}`;
    const session = await detail(id);
    expect(session).toMatchObject({ title: "终端里的会话", cwd: project, references: [] });
    expect(session.messages[0]).toMatchObject({ parts: [{ type: "text", text: "终端里问的" }] });
    await (await send(id, "在 Hub 里继续")).text();
    await idle(id);
    expect(provider.calls[0]).toMatchObject({ resumeSessionId: outside, cwd: project });
    expect((await server.app.request(url(`${name}:unknown`))).status).toBe(404);
  });

  it("uploads session-owned files, rejects foreign attachments and keeps them outside the project", async () => {
    const id = await create();
    const foreign = await create();
    await idle(id);
    await idle(foreign);
    const form = new FormData();
    form.set("file", new File(["paper attachment"], "研究资料.pdf", { type: "application/pdf" }));
    const upload = await server.app.request(url(id, "/attachments"), {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const attachment = await upload.json().then((body) => body.data);
    expect(attachment).not.toHaveProperty("path");
    expect(attachment.url).toBe(url(id, `/attachments/${attachment.id}`));
    expect((await server.app.request(attachment.url)).headers.get("content-disposition")).toContain(
      "attachment;",
    );
    const post = (sessionId: string) =>
      server.app.request(url(sessionId, "/messages"), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "attached", text: "", attachmentIds: [attachment.id] }),
      });
    const inputs = provider.inputs.length;
    expect((await post(foreign)).status).toBe(404);
    expect(provider.inputs).toHaveLength(inputs);
    await (await post(id)).text();
    await idle(id);
    expect(provider.inputs.at(-1)).toContain("研究资料.pdf");
    const uploaded = provider.messages.at(-1)?.attachments?.[0];
    expect(uploaded?.path).toContain(join(dataDir, "attachments"));
    expect(uploaded?.path).not.toContain(project);
    expect(provider.calls.map((call) => call.additionalDirectories?.[0])).toContain(
      join(uploaded?.path ?? "", ".."),
    );
    expect(await readFile(uploaded?.path ?? "", "utf8")).toBe("paper attachment");
    expect((await detail(id)).messages[2]?.parts).toEqual([
      expect.objectContaining({ type: "file", filename: "研究资料.pdf", url: attachment.url }),
    ]);
    await server.close();
    await start();
    expect(await (await server.app.request(attachment.url)).text()).toBe("paper attachment");
    await unlink(uploaded?.path ?? "");
    await symlink(join(project), uploaded?.path ?? "");
    expect((await server.app.request(attachment.url)).status).toBe(422);
  });

  it("keeps the worker when a stopped turn settles, so the next message reuses it", async () => {
    const id = await create("slow");
    await expect.poll(() => state(id)).toBe("running");
    await server.sessions.stop(id);
    expect(provider.interruptions).toBe(1);
    // The transcript kept no reply for the stopped turn; what it showed is kept instead.
    const stopped = await detail(id);
    expect(stopped.state).toBe("interrupted");
    expect(JSON.stringify(stopped.messages[1]?.parts)).toContain("文献回答");
    await (await send(id, "next")).text();
    await idle(id);
    expect(provider.calls).toHaveLength(1);
    expect(provider.inputs.at(-1)).toContain("next");
  });

  it("runs durable queued messages in order once, and pauses them across stop and restart", async () => {
    const id = await create("approval");
    await expect.poll(async () => (await detail(id)).pendingInput?.id).toBeTruthy();
    const enqueue = (messageId: string, text: string) =>
      server.app.request(url(id, "/queue"), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: messageId, text }),
      });
    expect((await enqueue("q1", "second")).status).toBe(200);
    await enqueue("q1", "second");
    await enqueue("q2", "third");
    expect((await detail(id)).queuedMessages).toHaveLength(2);
    const request = (await detail(id)).pendingInput;
    server.sessions.input(id, request?.id ?? "", "deny");
    await expect.poll(() => provider.inputs.length).toBe(3);
    await idle(id);
    expect(provider.inputs[1]).toContain("second");
    expect(provider.inputs[2]).toContain("third");
    expect((await detail(id)).queuedMessages).toEqual([]);
    const stopped = await send(id, "slow");
    await enqueue("q3", "after restart");
    await server.sessions.stop(id);
    await stopped.text();
    expect((await detail(id)).queuePaused).toBe(true);
    await server.close();
    await start();
    expect((await detail(id)).queuedMessages).toHaveLength(1);
    expect((await detail(id)).queuePaused).toBe(true);
    await server.sessions.editQueue(id, "resume");
    await expect
      .poll(() => provider.inputs.some((text) => text.includes("after restart")))
      .toBe(true);
    await idle(id);
  });

  it("activates only the selected research skill and confines the file tree to the project", async () => {
    await writeFile(join(project, "result.md"), "# 真实输出\n文件内容");
    await writeFile(join(root, "outside.txt"), "private");
    await symlink(join(root, "outside.txt"), join(project, "outside-link"));
    const id = await create("/review-fixture 分析论文");
    await idle(id);
    const tree = await server.app.request(url(id, "/fs/browse"));
    expect(
      (await tree.json().then((body) => body.data)).entries.map(
        (entry: { name: string }) => entry.name,
      ),
    ).toEqual(["result.md"]);
    const preview = await server.app.request(url(id, "/fs/file?path=result.md"));
    expect((await preview.json().then((body) => body.data)).content).toContain("真实输出");
    for (const path of ["../outside.txt", "outside-link", join(root, "outside.txt")]) {
      expect(
        (await server.app.request(url(id, `/fs/file?path=${encodeURIComponent(path)}`))).status,
      ).toBe(422);
    }
    expect(provider.inputs[0]).toContain("RESEARCH_SKILL_INSTRUCTIONS 分析论文");
    expect((await detail(id)).messages[0]?.parts).toEqual([
      { type: "text", text: "/review-fixture 分析论文" },
    ]);
    await (await send(id, "普通问题")).text();
    expect(provider.inputs[1]).not.toContain("RESEARCH_SKILL_INSTRUCTIONS");
  });

  it("applies execution controls, and resumes with a changed model", async () => {
    const id = await create("first", undefined, {
      model: "first-model",
      permissionMode: "plan",
      thinking: "adaptive",
      effort: "high",
    });
    await idle(id);
    expect(provider.calls[0]).toMatchObject({
      model: "first-model",
      permissionMode: "plan",
      thinking: { type: "adaptive" },
      effort: "high",
    });
    const options = (value: object) =>
      server.app.request(url(id, "/options"), {
        method: "PATCH",
        headers,
        body: JSON.stringify(value),
      });
    expect((await options({ model: "second-model", permissionMode: "default" })).status).toBe(200);
    await (await send(id, "second")).text();
    await idle(id);
    expect(provider.calls.at(-1)).toMatchObject({
      model: "second-model",
      permissionMode: "default",
    });
    expect((await detail(id)).messages).toHaveLength(4);
    const running = await send(id, "approval slow");
    await expect.poll(() => state(id)).toBe("waiting-input");
    const callsBefore = provider.calls.length;
    const changed = await options({ model: "during-run", permissionMode: "plan" });
    expect(changed.status).toBe(200);
    expect(await changed.json().then((body) => body.data)).toMatchObject({
      model: "during-run",
      pendingOptions: ["model", "permissionMode"],
    });
    // The running turn keeps the process it started with.
    expect(provider.calls).toHaveLength(callsBefore);
    await server.sessions.stop(id);
    await running.text();
    await (await send(id, "third")).text();
    await idle(id);
    expect(provider.calls.at(-1)).toMatchObject({ model: "during-run", permissionMode: "plan" });
    expect((await detail(id)).pendingOptions).toBeUndefined();
  });

  it("claims a new chat's draft uploads for its first message", async () => {
    const form = new FormData();
    form.set("file", new File(["draft notes"], "草稿.txt", { type: "text/plain" }));
    const upload = await server.app.request("/api/sessions/draft-attachments", {
      method: "POST",
      headers: { "ScholarAIO-Hub": "true" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const draft = await upload.json().then((body) => body.data);
    expect(draft.url).toBe(`/api/sessions/draft-attachments/${draft.id}`);
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: name,
        message: { id: crypto.randomUUID(), text: "看附件", attachmentIds: [draft.id] },
      }),
    });
    expect(created.status).toBe(201);
    const session = await created.json().then((body) => body.data);
    await idle(session.id);
    expect(provider.calls[0]?.initialMessage?.attachments?.[0]?.originalName).toBe("草稿.txt");
    const read = await server.app.request(url(session.id, `/attachments/${draft.id}`), {
      headers,
    });
    expect(await read.text()).toBe("draft notes");
    // A claimed draft is gone from the draft area.
    const again = await server.app.request(`/api/sessions/draft-attachments/${draft.id}`, {
      method: "DELETE",
      headers,
    });
    expect(again.status).toBe(404);
    // Without a project, the session got a folder of its own.
    expect(provider.calls[0]?.cwd).toContain(join(dataDir, "scratch"));
    expect((await detail(session.id)).projectId).toBeUndefined();
  });

  it("removes an unsent attachment but keeps one a message refers to", async () => {
    const id = await create();
    await idle(id);
    const upload = async (text: string) => {
      const form = new FormData();
      form.set("file", new File([text], `${text}.txt`, { type: "text/plain" }));
      const response = await server.app.request(url(id, "/attachments"), {
        method: "POST",
        headers: { "ScholarAIO-Hub": "true" },
        body: form,
      });
      return (await response.json().then((body) => body.data)).id as string;
    };
    const unsent = await upload("unsent");
    const sent = await upload("sent");
    const remove = (attachmentId: string) =>
      server.app.request(url(id, `/attachments/${attachmentId}`), { method: "DELETE", headers });
    expect((await remove(unsent)).status).toBe(204);
    expect((await server.app.request(url(id, `/attachments/${unsent}`), { headers })).status).toBe(
      404,
    );
    await (
      await server.app.request(url(id, "/messages"), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: crypto.randomUUID(), text: "带附件", attachmentIds: [sent] }),
      })
    ).text();
    await idle(id);
    expect((await remove(sent)).status).toBe(409);
  });

  it("sweeps draft uploads nobody claimed within a day", async () => {
    const draft = await server.attachments.uploadDraft(
      new File(["old"], "old.txt", { type: "text/plain" }),
    );
    await server.attachments.sweepDrafts(Date.now() + 25 * 60 * 60 * 1000);
    await expect(server.attachments.removeDraft(draft.id)).rejects.toThrow("has been removed");
  });

  it("lists the provider's own commands for the session's directory, then research skills", async () => {
    provider.commands = [
      {
        name: "compact",
        description: "Compact",
        source: "provider",
        trigger: "/",
        position: "leading",
      },
    ];
    const id = await create();
    await idle(id);
    const response = await server.app.request(url(id, "/commands"), { headers });
    expect(response.status).toBe(200);
    const { commands } = await response.json().then((body) => body.data);
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
    expect(provider.commandCwds.at(-1)).toBe(project);
    const draft = await server.app.request(
      `/api/sessions/commands?provider=${name}&cwd=${encodeURIComponent(project)}`,
      { headers },
    );
    expect(draft.status).toBe(200);
    expect(provider.commandCwds.at(-1)).toBe(project);
    await server.app.request(`/api/sessions/commands?provider=${name}`, { headers });
    expect(provider.commandCwds.at(-1)).toBe(join(dataDir, "draft-workspace"));
  });

  it("accepts only efforts the chosen model offers", async () => {
    provider.models = [
      { id: "fast", name: "Fast", isDefault: true, efforts: [{ id: "low" }] },
      { id: "deep", name: "Deep", efforts: [{ id: "low" }, { id: "xhigh" }] },
    ];
    const id = await create();
    await idle(id);
    const options = (value: object) =>
      server.app.request(url(id, "/options"), {
        method: "PATCH",
        headers,
        body: JSON.stringify(value),
      });
    expect((await options({ effort: "xhigh" })).status).toBe(422);
    expect((await options({ model: "deep", effort: "xhigh" })).status).toBe(200);
    expect((await options({ model: "fast" })).status).toBe(422);
    expect((await options({ effort: "" })).status).toBe(200);
    expect((await detail(id)).effort).toBeUndefined();
    expect((await options({ thinking: "on:high" })).status).toBe(422);
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name, effort: "xhigh", message: { id: "m", text: "x" } }),
    });
    expect(created.status).toBe(422);
  });

  it("forks through a turn into a new session that resumes a native fork in the same directory", async () => {
    const id = await create("第一问", "u1");
    await idle(id);
    await (await send(id, "第二问", "u2")).text();
    await idle(id);
    const response = await server.app.request(url(id, "/fork"), {
      method: "POST",
      headers,
      body: JSON.stringify({ messageId: "u1" }),
    });
    expect(response.status).toBe(201);
    const fork = await response.json().then((body) => body.data);
    expect(fork.id).toBe(`${name}:${provider.forks[0]?.forkedId}`);
    expect(fork).toMatchObject({ cwd: project, references: [PAPER] });
    expect(fork.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(fork.messages[0].parts).toEqual([{ type: "text", text: "第一问" }]);
    expect(provider.forks).toEqual([
      expect.objectContaining({
        sessionId: (await detail(id)).nativeId,
        dropTurns: 1,
        cwd: project,
      }),
    ]);
    expect((await detail(id)).messages).toHaveLength(4);
    await (await send(fork.id, "分叉后继续")).text();
    await idle(fork.id);
    expect(provider.calls.at(-1)?.resumeSessionId).toBe(provider.forks[0]?.forkedId);
    expect(provider.calls.at(-1)?.cwd).toBe(project);
  });

  it("corrects the last prompt in one request, cutting the same native session in place", async () => {
    const id = await create("第一问", "u1");
    await idle(id);
    await (await send(id, "第二问", "u2")).text();
    await idle(id);
    const native = (await detail(id)).nativeId;
    const correct = (replaces: string, text: string) =>
      server.app.request(url(id, "/messages"), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: replaces, text, replaces }),
      });
    // Only the last prompt can be corrected, and never a session's first; nothing changes otherwise.
    expect((await correct("u1", "改第一问")).status).toBe(409);
    expect((await correct("missing", "改")).status).toBe(409);
    expect((await detail(id)).messages).toHaveLength(4);
    expect(provider.rewinds).toEqual([]);

    const launches = provider.calls.length;
    await (await correct("u2", "改过的第二问")).text();
    await idle(id);
    const messages = (await detail(id)).messages;
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[2]).toMatchObject({
      id: "u2",
      parts: [{ type: "text", text: "改过的第二问" }],
    });
    expect(provider.forks).toEqual([]);
    expect(provider.rewinds).toEqual([
      expect.objectContaining({ sessionId: native, dropTurns: 1 }),
    ]);
    // The correction resumes the same native session at the cut, in a new process.
    expect(provider.calls).toHaveLength(launches + 1);
    expect(provider.calls.at(-1)).toMatchObject({
      resumeSessionId: native,
      resumeAt: provider.rewinds[0]?.resumeAt,
    });
    expect(server.store.find(id)?.nativeResumeAt).toBeUndefined();
    expect(provider.inputs.at(-1)).toContain("改过的第二问");
  });

  it("renames and archives a session without touching the provider's files, and forks it whole", async () => {
    const id = await create("第一问", "u1");
    await idle(id);
    const rename = await server.app.request(url(id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "  新标题 " }),
    });
    expect((await rename.json().then((body) => body.data)).title).toBe("新标题");
    const project = (await detail(id)).projectId;
    const listedTitles = async () =>
      (
        await (await server.app.request(`/api/projects/${project}/sessions`)).json()
      ).data.sessions.map((session: { title: string }) => session.title);
    expect(await listedTitles()).toEqual(["新标题"]);
    const forked = await server.app.request(url(id, "/fork"), { method: "POST", headers });
    expect(forked.status).toBe(201);
    const fork = await forked.json().then((body) => body.data);
    expect(fork.messages).toHaveLength(2);
    expect(fork.title).toBe("新标题 (fork)");
    expect(provider.forks.at(-1)?.dropTurns).toBe(0);

    const listed = async () =>
      (await (await server.app.request("/api/projects")).json()).data.projects[0]?.sessionCounts[
        name
      ];
    expect(await listed()).toBe(2);
    const archived = await server.app.request(url(id), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status).toBe(200);
    expect(await listed()).toBe(1);
    // Still there to open; nothing was deleted.
    expect((await server.app.request(url(id))).status).toBe(200);
    expect(provider.kept.has((await detail(id)).nativeId)).toBe(true);
  });

  it("keeps referring to the literature a message named, and to none unless asked", async () => {
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: name, message: { id: crypto.randomUUID(), text: "你好" } }),
    });
    const id = (await created.json().then((body) => body.data)).id as string;
    const first = await (await server.app.request(url(id, "/stream"))).text();
    await idle(id);
    expect(first).not.toContain("data-citations");
    expect(provider.inputs[0]).not.toContain("library_context");

    const collection = { kind: "collection", id: "综述" } as const;
    await (
      await server.app.request(url(id, "/messages"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          text: "看看这组",
          references: [collection],
        }),
      })
    ).text();
    await idle(id);
    expect(provider.inputs[1]).toContain("library_context");
    // The agent is told which collections by name, which its `scholaraio ws` commands take.
    expect(provider.inputs[1]).toContain("本会话引用的文献集合：综述集合");
    expect(
      library.asked.find(
        (asked) => asked.resource === "/context" && asked.body?.collectionIds?.length,
      ),
    ).toMatchObject({
      resource: "/context",
      body: { collectionIds: ["综述"], paperIds: [] },
    });
    // The session keeps the reference for later turns.
    await (await send(id, "再问一次")).text();
    await idle(id);
    expect(provider.inputs[2]).toContain("library_context");
    expect((await detail(id)).references).toEqual([collection]);

    const replaced = await server.app.request(url(id, "/references"), {
      method: "PUT",
      headers,
      body: JSON.stringify({ references: [PAPER] }),
    });
    expect((await replaced.json()).data.references).toEqual([PAPER]);
  });

  it("keeps a run alive after disconnect, replays once, and interrupts the provider", async () => {
    const id = await create("slow");
    await expect.poll(() => provider.inputs.length).toBe(1);
    const first = await server.app.request(url(id, "/stream"));
    await first.body?.cancel();
    expect(provider.interruptions).toBe(0);
    // The running prompt shows; its answer comes from the stream.
    expect((await detail(id)).messages).toHaveLength(1);
    const resumed = await server.app.request(url(id, "/stream"));
    const stopped = await server.app.request(url(id, "/stop"), { method: "POST", headers });
    expect(stopped.status).toBe(200);
    expect(provider.interruptions).toBe(1);
    const text = await resumed.text();
    expect(text.match(/"type":"start"/g)).toHaveLength(1);
    expect(text.match(/"type":"finish"/g)).toHaveLength(1);
  });

  it("preserves approvals and lists the session under its project", async () => {
    const id = await create("approval");
    await expect.poll(async () => (await detail(id)).pendingInput?.id).toBeTruthy();
    const pending = (await detail(id)).pendingInput;
    expect(pending?.sessionId).toBe(id);
    const running = await server.app.request(
      `/api/projects/${(await detail(id)).projectId}/sessions`,
    );
    expect((await running.json()).data.sessions).toMatchObject([{ id, state: "waiting-input" }]);
    const decision = await server.app.request(url(id, "/input"), {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "deny" }),
    });
    expect(decision.status).toBe(200);
    await idle(id);
    expect(provider.approvals).toEqual(["deny"]);
    // Literature collections are the library service's; the browser asks it directly.
    expect((await server.app.request("/api/collections")).status).toBe(404);
  });

  it("pushes the pending decision to the open stream without storing it", async () => {
    const id = await create("approval");
    const response = await server.app.request(url(id, "/stream"));
    await expect.poll(async () => (await detail(id)).pendingInput?.id).toBeTruthy();
    const pending = (await detail(id)).pendingInput;
    await server.app.request(url(id, "/input"), {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "deny" }),
    });
    const text = await response.text();
    expect(text).toContain('"type":"data-session-state"');
    expect(text).toContain('"state":"waiting-input"');
    expect(text).toContain(`"id":"${pending?.id}"`);
    await idle(id);
    const stored = (await detail(id)).messages.flatMap((message) => message.parts);
    expect(stored.some((part) => part.type === "data-session-state")).toBe(false);
  });

  it("approves and switches to accept-edits like the original approval panel", async () => {
    const id = await create("approval");
    await expect.poll(async () => (await detail(id)).pendingInput?.id).toBeTruthy();
    const pending = (await detail(id)).pendingInput;
    const decision = await server.app.request(url(id, "/input"), {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId: pending?.id, decision: "approve_accept_edits" }),
    });
    expect(decision.status).toBe(200);
    await idle(id);
    expect(provider.approvals).toEqual(["allow"]);
    expect((await detail(id)).permissionMode).toBe("acceptEdits");
  });

  it("marks interrupted disk runs without replaying input", async () => {
    const record = await server.store.create({
      provider: name,
      nativeId: "native",
      cwd: project,
      attachments: "3f2b7c1e-0000-4000-8000-000000000000",
    });
    record.state = "running";
    await server.store.save(record);
    const restarted = new SessionStore(dataDir);
    await restarted.initialize();
    expect(restarted.find(`${name}:native`)?.state).toBe("interrupted");
    expect(provider.calls).toHaveLength(0);
  });
});
