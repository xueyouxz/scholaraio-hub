import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { ClaudeProvider } from "../../src/providers/claude/ClaudeProvider.js";
import { CodexProvider } from "../../src/providers/codex/CodexProvider.js";
import { createTestApp } from "../helpers/app.js";
import { libraryResponse } from "../helpers/library.js";
import { TEST_LIBRARY_URL } from "../helpers/library.js";

class EmptyLibrary extends LibraryClient {
  override async request() {
    return libraryResponse({ citations: [], truncated: false });
  }
}
const enabled = process.env.REAL_HUB_TESTS === "true";
describe.skipIf(!enabled)("real application sessions", () => {
  for (const name of ["claude", "codex"] as const) {
    it.skipIf(Boolean(process.env.REAL_HUB_PROVIDER && process.env.REAL_HUB_PROVIDER !== name))(
      `${name} persists and resumes after restart`,
      async () => {
        const root = await mkdtemp(join(tmpdir(), "hub-real-cli-"));
        const provider = name === "claude" ? new ClaudeProvider() : new CodexProvider();
        let server = createTestApp({
          dataDir: root,
          provider,
          library: new EmptyLibrary(TEST_LIBRARY_URL),
        });
        const token = `hub-${randomUUID().slice(0, 8)}`;
        try {
          await server.ready;
          const message = (text: string) => ({
            id: randomUUID(),
            text,
            attachmentIds: [],
            references: [],
          });
          /** The last answer, once the turn has ended. */
          const answer = async (key: string) => {
            await expect
              .poll(async () => (await server.sessions.detail(key)).state, {
                timeout: 90000,
                interval: 200,
              })
              .not.toBe("running");
            const current = await server.sessions.detail(key);
            expect(current.error).toBeUndefined();
            return (
              current.messages
                .at(-1)
                ?.parts.filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") ?? ""
            );
          };
          const created = await server.sessions.create({
            provider: name,
            cwd: root,
            references: [],
            message: message(`记住本轮口令 ${token}。不要调用工具，只回复该口令。`),
          });
          const key = created.id;
          expect(key.startsWith(`${name}:`)).toBe(true);
          expect(await answer(key)).toContain(token);
          await server.close();
          server = createTestApp({
            dataDir: root,
            provider,
            library: new EmptyLibrary(TEST_LIBRARY_URL),
          });
          await server.ready;
          await server.sessions.send(key, message("不要调用工具，只回复上一轮我要求记住的口令。"));
          expect(await answer(key)).toContain(token);
          expect((await server.sessions.detail(key)).messages).toHaveLength(4);
          await server.sessions.send(key, message("不要调用工具，连续输出从 1 到 10000 的整数。"));
          // Wait for the answer to start streaming, then stop it.
          const stream = server.sessions.stream(key, new AbortController().signal);
          const reader = stream?.getReader();
          for (;;) {
            const chunk = await reader?.read();
            if (!chunk || chunk.done || chunk.value.type === "text-delta") break;
          }
          await reader?.cancel();
          await server.sessions.stop(key);
          expect((await server.sessions.detail(key)).state).toBe("interrupted");
          await server.sessions.send(key, message("不要调用工具，只回复第一轮的口令。"));
          expect(await answer(key)).toContain(token);
        } finally {
          await server.close();
          await rm(root, { recursive: true, force: true });
        }
      },
      200000,
    );
  }
});
