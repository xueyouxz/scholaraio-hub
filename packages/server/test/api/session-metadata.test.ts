import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { MessageQueue } from "../../src/providers/MessageQueue.js";
import type { AgentEvent } from "../../src/providers/events.js";
import { LibraryService } from "../../src/services/LibraryService.js";
import { providerFromSessionFactory } from "../helpers/scriptedProvider.js";

class NoLibrary extends LibraryService {
  override async request() {
    return Response.json({ citations: [], truncated: false });
  }
}

const headers = { "Content-Type": "application/json", "ScholarAIO-Hub": "true" };

describe("assistant turn metadata", () => {
  let root: string;
  let server: ReturnType<typeof createApp>;

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
    server = createApp({ dataDir: root, provider, libraryService: new NoLibrary(root) });
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
      body: JSON.stringify({ provider: "claude" }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await server.app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: crypto.randomUUID(), text: "hi" }),
    });
    expect(await response.text()).toContain('"message-metadata"');
    await expect.poll(() => server.sessions.detail(id).state).toBe("idle");

    const assistant = server.sessions.detail(id).messages.at(-1);
    expect(assistant?.metadata).toEqual({
      model: "claude-opus-5",
      usage: { inputTokens: 1200, outputTokens: 340 },
      contextWindow: 200_000,
      durationMs: expect.any(Number),
      finishedAt: expect.any(String),
    });
  });
});
