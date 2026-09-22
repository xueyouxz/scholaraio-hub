import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UIChunkWriter } from "../../../src/agent/uiChunks.js";
import { CodexProvider } from "../../../src/sdk/providers/codex.js";

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
});
