#!/usr/bin/env node
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
        readOnlyAccess: { type: "fullAccess" },
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
  } else if (message.method === "turn/interrupt") {
    reply({});
    complete();
  }
}
