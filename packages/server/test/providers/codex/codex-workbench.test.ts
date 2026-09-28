import { chmod, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexProvider } from "../../../src/providers/codex/CodexProvider.js";
import type { AgentEvent } from "../../../src/providers/events.js";
import { UIChunkWriter } from "../../../src/sessions/UIChunkWriter.js";

describe("Codex app-server compatibility", () => {
  let root: string;
  let provider: CodexProvider;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "codex-protocol-"));
    const command = path.join(root, "codex-fixture.mjs");
    await copyFile(
      fileURLToPath(new URL("../../fixtures/codex-app-server.mjs", import.meta.url)),
      command,
    );
    await chmod(command, 0o700);
    provider = new CodexProvider({ codexPath: command });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists stored threads from every page, without subagents or ephemeral ones", async () => {
    const log = path.join(root, "requests.jsonl");
    process.env.CODEX_FIXTURE_LOG = log;
    try {
      await expect(provider.listSessions()).resolves.toEqual([
        {
          id: "stored-thread",
          cwd: "/fixture-root",
          title: "修复构建",
          createdAt: "2026-09-21T14:13:20.000Z",
          updatedAt: "2026-09-21T14:23:20.000Z",
          gitBranch: "main",
        },
      ]);
    } finally {
      Reflect.deleteProperty(process.env, "CODEX_FIXTURE_LOG");
    }
    const requests = (await readFile(log, "utf8")).trim().split("\n");
    expect(JSON.parse(requests[0] ?? "{}").params).toMatchObject({
      cursor: null,
      sortKey: "updated_at",
      // Every model provider, and the Hub's own threads besides interactive ones.
      modelProviders: [],
      sourceKinds: ["cli", "vscode", "appServer"],
      useStateDbOnly: true,
    });
    expect(JSON.parse(requests[1] ?? "{}").params).toMatchObject({ cursor: "page-2" });
  });

  it("reads a stored thread's turns through the live event adapter", async () => {
    const turns = await provider.readSession("stored-thread", { cwd: root });
    expect(turns.map(({ id, prompt, at }) => ({ id, prompt, at }))).toEqual([
      { id: "stored-turn-1", prompt: "修复构建", at: "2026-09-21T14:13:20.000Z" },
      { id: "stored-turn-2", prompt: "继续", at: undefined },
    ]);
    expect(turns[0]?.events.map((event) => event.type)).toEqual([
      "reasoning.delta",
      "tool.call",
      "tool.result",
      "text.delta",
      "turn.completed",
    ]);
    expect(turns[0]?.events[1]).toMatchObject({ name: "Bash", input: { command: "pnpm build" } });
    expect(turns[1]?.events).toEqual([{ type: "turn.completed", error: "usage limit reached" }]);
  });

  it("rewinds a paginated thread in place and forks a legacy one without the turns", async () => {
    const log = path.join(root, "requests.jsonl");
    const cut = { sessionId: "native-fixture-thread", cwd: root };
    process.env.CODEX_FIXTURE_LOG = log;
    try {
      await expect(provider.rewindSession({ ...cut, dropTurns: 2 })).resolves.toEqual({
        sessionId: "native-fixture-thread",
      });
      process.env.CODEX_FIXTURE_HISTORY = "legacy";
      await expect(provider.rewindSession({ ...cut, dropTurns: 1 })).resolves.toEqual({
        sessionId: "forked-fixture-thread",
      });
    } finally {
      Reflect.deleteProperty(process.env, "CODEX_FIXTURE_LOG");
      Reflect.deleteProperty(process.env, "CODEX_FIXTURE_HISTORY");
    }
    const requests = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; params: unknown });
    expect(requests).toEqual([
      { method: "thread/read", params: { threadId: cut.sessionId, includeTurns: false } },
      { method: "thread/resume", params: { threadId: cut.sessionId, excludeTurns: true } },
      {
        method: "thread/turns/list",
        params: { threadId: cut.sessionId, limit: 2, sortDirection: "desc" },
      },
      { method: "thread/revert", params: { threadId: cut.sessionId, beforeTurnId: "turn-2" } },
      { method: "thread/read", params: { threadId: cut.sessionId, includeTurns: false } },
      { method: "thread/fork", params: { threadId: cut.sessionId, cwd: root } },
      { method: "thread/rollback", params: { threadId: "forked-fixture-thread", numTurns: 1 } },
    ]);
  });
  it("preserves native policies, authentication, tool approval, and delta/snapshot identity", async () => {
    expect(await provider.getAuthStatus()).toMatchObject({ installed: true, authenticated: true });
    let approvals = 0;
    const session = await provider.startSession({
      cwd: root,
      initialMessage: { text: "approval" },
      onToolApproval: async () => {
        approvals++;
        return { behavior: "deny", message: "denied by test" };
      },
    });
    const chunks: UIMessageChunk[] = [];
    const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
    try {
      for await (const event of session.events) {
        writer.write(event);
        if (event.type === "turn.completed") {
          expect(event.error, JSON.stringify(event)).toBeUndefined();
          break;
        }
      }
      expect(approvals).toBe(1);
      expect(
        chunks
          .filter((chunk) => chunk.type === "text-delta")
          .map((chunk) => chunk.delta)
          .join(""),
      ).toBe("Fixture reply");
      expect(chunks.filter((chunk) => chunk.type === "text-start")).toHaveLength(1);
    } finally {
      session.abort();
    }
  });
  it("releases an idle queue when aborted", async () => {
    const session = await provider.startSession({ cwd: root, initialMessage: { text: "hello" } });
    while (true) {
      const next = await session.events.next();
      expect(next.done).not.toBe(true);
      if (next.value?.type === "turn.completed") {
        expect(next.value.error).toBeUndefined();
        break;
      }
    }
    const waiting = session.events.next();
    session.abort();
    await waiting;
    await session.events.return?.();
  });
  it("interrupts an active native turn", async () => {
    const session = await provider.startSession({ cwd: root, initialMessage: { text: "slow" } });
    let interrupted = false;
    let completed = false;
    try {
      for await (const event of session.events) {
        if (event.type === "text.delta" && !interrupted) {
          await session.interrupt?.();
          interrupted = true;
        }
        if (event.type === "turn.completed") {
          expect(event.error, JSON.stringify(event)).toBeUndefined();
          completed = true;
          break;
        }
      }
      expect(interrupted).toBe(true);
      expect(completed).toBe(true);
    } finally {
      session.abort();
    }
  });

  /**
   * Events up to the end of the next turn: its reply text and its error. Reads
   * with next(), since leaving a for-await loop would end the session.
   */
  async function nextTurn(events: AsyncIterableIterator<AgentEvent>) {
    let text = "";
    while (true) {
      const next = await events.next();
      if (next.done) return { text, error: "stream ended" };
      const event = next.value;
      if (event.type === "text.delta") text += event.delta;
      if (event.type === "turn.completed") return { text, error: event.error };
    }
  }

  it("sends a changed permission mode's sandbox with the next turn", async () => {
    const session = await provider.startSession({ cwd: root, initialMessage: { text: "one" } });
    try {
      expect((await nextTurn(session.events)).text).toBe("Fixture reply");
      session.setPermissionMode?.("bypassPermissions");
      session.queue.push({ text: "two" });
      expect((await nextTurn(session.events)).text).toBe("Fixture reply (dangerFullAccess)");
      session.setPermissionMode?.("default");
      session.queue.push({ text: "three" });
      // Back to the thread's own workspace policy, writable roots included.
      expect((await nextTurn(session.events)).text).toBe(
        "Fixture reply (workspaceWrite /fixture-root)",
      );
    } finally {
      session.abort();
    }
  });

  it("cancels the turn when the user's denial stops it", async () => {
    const session = await provider.startSession({
      cwd: root,
      initialMessage: { text: "approval" },
      onToolApproval: async () => ({ behavior: "deny", message: "no", interrupt: true }),
    });
    try {
      expect((await nextTurn(session.events)).text).toBe("Fixture reply (cancel)");
    } finally {
      session.abort();
    }
  });

  it("answers a request it does not support with an error", async () => {
    const session = await provider.startSession({
      cwd: root,
      initialMessage: { text: "unsupported" },
    });
    try {
      expect((await nextTurn(session.events)).text).toBe("Fixture reply (error reply)");
    } finally {
      session.abort();
    }
  });

  it("fails the turn with what the app-server said before it crashed", async () => {
    const session = await provider.startSession({ cwd: root, initialMessage: { text: "crash" } });
    try {
      expect((await nextTurn(session.events)).error).toContain("fatal: fixture crashed");
    } finally {
      session.abort();
    }
  });

  it("ends the session when the app-server exits between turns", async () => {
    const session = await provider.startSession({
      cwd: root,
      initialMessage: { text: "exit after" },
    });
    try {
      expect((await nextTurn(session.events)).error).toBeUndefined();
      expect((await session.events.next()).done).toBe(true);
    } finally {
      session.abort();
    }
  });
});
