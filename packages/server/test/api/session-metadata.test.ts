import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryClient } from "../../src/lib/LibraryClient.js";
import { MessageQueue } from "../../src/providers/MessageQueue.js";
import type { AgentEvent } from "../../src/providers/events.js";
import { createTestApp } from "../helpers/app.js";
import { libraryResponse } from "../helpers/library.js";
import { TEST_LIBRARY_URL } from "../helpers/library.js";
import { providerFromSessionFactory } from "../helpers/scriptedProvider.js";

class NoLibrary extends LibraryClient {
  override async request() {
    return libraryResponse({ citations: [], truncated: false });
  }
}

const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

describe("assistant turn metadata", () => {
  let root: string;
  let server: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-metadata-"));
    const provider = providerFromSessionFactory(async (options) => {
      const queue = new MessageQueue();
      if (options.initialMessage) queue.push(options.initialMessage);
      async function* events(): AsyncIterableIterator<AgentEvent> {
        yield { type: "session.started", sessionId: "native-1" };
        for await (const _ of queue.messages()) {
          yield { type: "model.resolved", model: "claude-opus-5" };
          yield { type: "text.delta", blockId: "b", delta: "ok" };
          yield {
            type: "turn.completed",
            usage: { inputTokens: 1200, outputTokens: 340 },
            contextWindow: 200_000,
          };
        }
      }
      return { events: events(), queue, abort: () => queue.close() };
    });
    server = createTestApp({ dataDir: root, provider, library: new NoLibrary(TEST_LIBRARY_URL) });
    await server.ready;
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("records which model answered and what the turn used", async () => {
    const created = await server.app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "claude", message: { id: "first", text: "hi" } }),
    });
    const { id } = (await created.json().then((body) => body.data)) as { id: string };
    expect(id).toBe("claude:native-1");
    await expect.poll(async () => (await server.sessions.detail(id)).state).toBe("idle");

    // The transcript is the provider's; the Hub keeps what it added to the answer.
    const prompt = Object.values(server.store.find(id)?.prompts ?? {})[0];
    expect(prompt?.inputId).toBe("first");
    expect(prompt?.metadata).toEqual({
      model: "claude-opus-5",
      usage: { inputTokens: 1200, outputTokens: 340 },
      contextWindow: 200_000,
      durationMs: expect.any(Number),
      finishedAt: expect.any(String),
    });
  });
});
