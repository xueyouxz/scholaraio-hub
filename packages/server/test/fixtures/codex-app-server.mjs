#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) {
  console.log("codex-cli fixture");
  process.exit(0);
}
if (process.argv.includes("login")) {
  console.log("Logged in using fixture");
  process.exit(0);
}
const lines = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
const threadId = "native-fixture-thread";
/** Thread-history requests, one JSON line each, for tests that check what was asked. */
const logRequest = (message) => {
  if (process.env.CODEX_FIXTURE_LOG)
    appendFileSync(
      process.env.CODEX_FIXTURE_LOG,
      `${JSON.stringify({ method: message.method, params: message.params })}\n`,
    );
};
/** A thread as `thread/list` reports one. */
const storedThread = (id, fields = {}) => ({
  id,
  cwd: "/fixture-root",
  name: "Build fix",
  preview: "",
  createdAt: 1790000000,
  updatedAt: 1790000600,
  gitInfo: { sha: null, branch: "main", originUrl: null },
  parentThreadId: null,
  ephemeral: false,
  turns: [],
  ...fields,
});
/** What `thread/read` with its turns returns for the stored thread. */
const storedTurns = [
  {
    id: "stored-turn-1",
    status: "completed",
    error: null,
    startedAt: 1790000000,
    items: [
      { type: "userMessage", id: "u1", content: [{ type: "text", text: "修复构建" }] },
      { type: "reasoning", id: "r1", summary: ["看看报错"], content: [] },
      {
        type: "commandExecution",
        id: "c1",
        command: "pnpm build",
        cwd: "/fixture-root",
        status: "completed",
        aggregatedOutput: "done",
        exitCode: 0,
        commandActions: [],
      },
      { type: "agentMessage", id: "m1", text: "构建已修复。" },
    ],
  },
  {
    id: "stored-turn-2",
    status: "failed",
    error: { message: "usage limit reached" },
    startedAt: null,
    items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "继续" }] }],
  },
];
/** The fixture thread's finished turns, newest first. */
const pastTurns = ["turn-3", "turn-2", "turn-1"];
let turn = 0;
let activeTurn;
let approval;
let unsupported;
/** The sandbox the last turn asked for, when it asked for one. */
let turnSandbox;
const complete = (note) => {
  const notes = [note, turnSandbox].filter(Boolean).map((text) => ` (${text})`);
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId: activeTurn,
      item: { id: `item-${turn}`, type: "agentMessage", text: `Fixture reply${notes.join("")}` },
    },
  });
  send({
    method: "turn/completed",
    params: { threadId, turn: { id: activeTurn, status: "completed", items: [], error: null } },
  });
};
for await (const line of lines) {
  const message = JSON.parse(line);
  const reply = (result) => send({ id: message.id, result });
  if (approval !== undefined && message.id === approval) {
    approval = undefined;
    complete(message.result.decision === "cancel" ? "cancel" : undefined);
    continue;
  }
  if (unsupported !== undefined && message.id === unsupported) {
    unsupported = undefined;
    complete(message.error ? "error reply" : "empty reply");
    continue;
  }
  if (message.method === "initialize") {
    if (message.params.clientInfo.name !== "scholaraio-hub")
      throw new Error("Unexpected client identity");
    reply({ userAgent: "fixture" });
  } else if (message.method === "thread/resume" && message.params.excludeTurns) {
    // Loaded only to rewind it; the launch that follows resumes it with its policies.
    logRequest(message);
    reply({ thread: { id: message.params.threadId, turns: [] } });
  } else if (["thread/start", "thread/resume"].includes(message.method)) {
    if (
      message.params.approvalPolicy !== "on-request" ||
      message.params.sandbox !== "workspace-write"
    )
      throw new Error("Permission defaults changed");
    reply({
      thread: { id: threadId, turns: [] },
      sandbox: {
        type: "workspaceWrite",
        writableRoots: ["/fixture-root"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });
  } else if (message.method === "turn/start") {
    activeTurn = `turn-${++turn}`;
    const policy = message.params.sandboxPolicy;
    turnSandbox = policy && [policy.type, ...(policy.writableRoots ?? [])].join(" ");
    reply({ turn: { id: activeTurn, status: "inProgress", items: [] } });
    send({
      method: "item/agentMessage/delta",
      params: { threadId, turnId: activeTurn, itemId: `item-${turn}`, delta: "Fixture " },
    });
    const text = message.params.input[0].text;
    if (text.includes("approval")) {
      approval = "approve-command";
      send({
        id: approval,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId: activeTurn,
          itemId: `command-${turn}`,
          command: "echo fixture",
          cwd: process.cwd(),
          reason: "test approval",
        },
      });
    } else if (text.includes("unsupported")) {
      unsupported = "unsupported-request";
      send({ id: unsupported, method: "item/tool/call", params: { threadId, turnId: activeTurn } });
    } else if (text.includes("crash")) {
      process.stderr.write("fatal: fixture crashed\n");
      process.exit(3);
    } else if (text.includes("exit after")) {
      complete();
      setTimeout(() => process.exit(0), 20);
    } else if (!text.includes("slow")) complete();
  } else if (message.method === "thread/list") {
    logRequest(message);
    // Two pages: a thread and a subagent's, then an ephemeral one.
    reply(
      message.params.cursor
        ? { data: [storedThread("ephemeral-thread", { ephemeral: true })], nextCursor: null }
        : {
            data: [
              storedThread("stored-thread", { name: null, preview: "修复构建" }),
              storedThread("subagent-thread", { parentThreadId: "stored-thread" }),
            ],
            nextCursor: "page-2",
          },
    );
  } else if (message.method === "thread/read") {
    logRequest(message);
    const historyMode = process.env.CODEX_FIXTURE_HISTORY ?? "paginated";
    const turns = message.params.includeTurns ? storedTurns : [];
    reply({ thread: { id: message.params.threadId, historyMode, turns } });
  } else if (message.method === "thread/turns/list") {
    logRequest(message);
    const turns = pastTurns.slice(0, message.params.limit ?? pastTurns.length);
    reply({
      data: turns.map((id) => ({ id, status: "completed", items: [] })),
      nextCursor: null,
      backwardsCursor: null,
    });
  } else if (message.method === "thread/revert") {
    logRequest(message);
    reply({
      thread: { id: message.params.threadId, turns: [] },
      turnsBackwardsCursor: null,
      itemsBackwardsCursor: null,
    });
  } else if (["thread/fork", "thread/rollback"].includes(message.method)) {
    logRequest(message);
    reply({ thread: { id: "forked-fixture-thread", turns: [] } });
  } else if (message.method === "turn/interrupt") {
    reply({});
    complete();
  }
}
