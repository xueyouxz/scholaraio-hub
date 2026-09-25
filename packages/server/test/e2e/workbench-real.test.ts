import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ClaudeProvider } from "../../src/providers/claude/ClaudeProvider.js";
import { CodexProvider } from "../../src/providers/codex/CodexProvider.js";
import { LibraryService } from "../../src/services/LibraryService.js";

class EmptyLibrary extends LibraryService {
  override async request() {
    return Response.json({ citations: [], truncated: false });
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
        let server = createApp({ dataDir: root, provider, libraryService: new EmptyLibrary(root) });
        const token = `hub-${randomUUID().slice(0, 8)}`;
        try {
          await server.ready;
          const record = await server.sessions.store.create({
            title: "CLI verification",
            provider: name,
            paperIds: [],
          });
          const turn = async (text: string) => {
            await server.sessions.send(record.id, { id: randomUUID(), text });
            await expect
              .poll(() => server.sessions.detail(record.id).state, {
                timeout: 90000,
                interval: 200,
              })
              .not.toBe("running");
            const current = server.sessions.detail(record.id);
            expect(current.error).toBeUndefined();
            return (
              current.messages
                .at(-1)
                ?.parts.filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") ?? ""
            );
          };
          expect(await turn(`记住本轮口令 ${token}。不要调用工具，只回复该口令。`)).toContain(
            token,
          );
          await server.close();
          server = createApp({ dataDir: root, provider, libraryService: new EmptyLibrary(root) });
          await server.ready;
          expect(await turn("不要调用工具，只回复上一轮我要求记住的口令。")).toContain(token);
          expect(server.sessions.detail(record.id).messages).toHaveLength(4);
          await server.sessions.send(record.id, {
            id: randomUUID(),
            text: "不要调用工具，连续输出从 1 到 10000 的整数。",
          });
          await expect
            .poll(
              () => {
                const message = server.sessions.store.get(record.id).messages.at(-1);
                return (
                  message?.role === "assistant" &&
                  message.parts.some((part) => part.type === "text" && part.text.length > 0)
                );
              },
              { timeout: 60000 },
            )
            .toBe(true);
          await server.sessions.stop(record.id);
          expect(server.sessions.detail(record.id).state).toBe("interrupted");
          expect(await turn("不要调用工具，只回复第一轮的口令。")).toContain(token);
        } finally {
          await server.close();
          await rm(root, { recursive: true, force: true });
        }
      },
      200000,
    );
  }
});
