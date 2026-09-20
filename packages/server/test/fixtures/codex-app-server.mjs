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
const complete = () => {
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId: activeTurn,
      item: { id: `item-${turn}`, type: "agentMessage", text: "Fixture reply" },
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
    complete();
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
    reply({ thread: { id: threadId, turns: [] } });
  } else if (message.method === "turn/start") {
    activeTurn = `turn-${++turn}`;
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
    } else if (!text.includes("slow")) complete();
  } else if (message.method === "turn/interrupt") {
    reply({});
    complete();
  }
}
