import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionMessage } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import { describe, expect, it } from "vitest";
import { CodexEventAdapter } from "../../../src/providers/codex/CodexEventAdapter.js";
import type { AgentEvent } from "../../../src/providers/events.js";
import { UIChunkWriter } from "../../../src/sessions/UIChunkWriter.js";

/**
 * Golden-file coverage for the Codex conversion pipeline.
 *
 * The contract under test is the whole path an app-server notification travels
 * before it reaches the browser: JSON-RPC notification -> AgentEvent ->
 * UIMessageChunk. Both stages are pinned, so a change shows up as a reviewable
 * diff of the golden file.
 *
 * Regenerate after an intentional change, then format (comparison is
 * structural, so layout never fails the test):
 *   UPDATE_GOLDEN=1 pnpm --filter @scholaraio-hub/server test codex-conversion
 *   pnpm lint:fix
 */

const FIXTURES = fileURLToPath(new URL("../../fixtures/codex-notifications/", import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface NotificationFixture {
  sessionId: string;
  notifications: { method: string; params?: unknown }[];
}

/** Turn ids the fixture refers to, so the adapter sees each turn open. */
function turnIdOf(notification: { params?: unknown }): string | undefined {
  const params = notification.params as { turnId?: unknown; turn?: { id?: unknown } } | undefined;
  const id = params?.turnId ?? params?.turn?.id;
  return typeof id === "string" ? id : undefined;
}

function convert(fixture: NotificationFixture): { events: AgentEvent[]; chunks: UIMessageChunk[] } {
  const adapter = new CodexEventAdapter();
  const events: AgentEvent[] = [...adapter.started(fixture.sessionId)];
  for (const notification of fixture.notifications) {
    const turnId = turnIdOf(notification);
    if (turnId && !adapter.activeTurn) adapter.beginTurn(turnId);
    events.push(...adapter.notification(notification));
  }
  const chunks: UIMessageChunk[] = [];
  const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
  for (const event of events) writer.write(event);
  writer.close();
  return { events, chunks };
}

function compareWithGolden(name: string, actual: unknown): void {
  const path = join(FIXTURES, `${name}.golden.json`);
  const serialized = `${JSON.stringify(actual, null, 2)}\n`;
  if (UPDATE) {
    writeFileSync(path, serialized);
    return;
  }
  let expected: string;
  try {
    expected = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Missing golden file ${path}. Regenerate with UPDATE_GOLDEN=1.`);
  }
  expect(JSON.parse(serialized)).toEqual(JSON.parse(expected));
}

describe("codex notification conversion", () => {
  for (const name of ["agent-turn", "tool-turn", "failed-turn", "streaming-turn", "collab-turn"]) {
    it(`converts ${name} into a stable event and chunk stream`, () => {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES, `${name}.json`), "utf-8"),
      ) as NotificationFixture;
      compareWithGolden(name, convert(fixture));
    });
  }

  it("ignores notifications that belong to another thread", () => {
    const { chunks } = convert({
      sessionId: "thread-golden",
      notifications: [
        {
          method: "item/agentMessage/delta",
          params: {
            threadId: "other-thread",
            turnId: "turn-1",
            itemId: "item-answer",
            delta: "leaked",
          },
        },
      ],
    });
    expect(chunks).toEqual([]);
  });

  it("ends each turn exactly once, however it ends", () => {
    const adapter = new CodexEventAdapter("thread");
    adapter.beginTurn("turn-1");
    const events = [
      ...adapter.notification({
        method: "error",
        params: {
          threadId: "thread",
          turnId: "turn-1",
          willRetry: true,
          error: { message: "overloaded" },
        },
      }),
      ...adapter.notification({
        method: "error",
        params: {
          threadId: "thread",
          turnId: "turn-1",
          willRetry: false,
          error: { message: "boom" },
        },
      }),
      ...adapter.notification({
        method: "turn/completed",
        params: { threadId: "thread", turn: { id: "turn-1", status: "failed" } },
      }),
      ...adapter.completeTurn(),
    ];
    expect(events).toEqual([
      { type: "notice", key: "retry-turn-1", level: "info", text: "overloaded（正在重试）" },
      { type: "turn.completed", error: "boom" },
    ]);
  });

  it("lets the browser show running output, then settle on the final result", async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES, "streaming-turn.json"), "utf-8"),
    ) as NotificationFixture;
    const { chunks } = convert(fixture);
    const snapshots: SessionMessage[] = [];
    for await (const message of readUIMessageStream<SessionMessage>({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start", messageId: "m" });
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.enqueue({ type: "finish" });
          controller.close();
        },
      }),
      terminateOnError: true,
    }))
      snapshots.push(structuredClone(message));

    const bash = (message: SessionMessage | undefined) =>
      message?.parts.find(
        (part) => part.type === "dynamic-tool" && part.toolCallId === "item-test",
      );
    const running = snapshots
      .map(bash)
      .find((part) => part && "preliminary" in part && part.preliminary);
    expect(running).toMatchObject({ output: { content: "running 3 tests\n" } });
    expect(bash(snapshots.at(-1))).toMatchObject({
      state: "output-available",
      output: { content: "running 3 tests\n3 passed\n", isError: false },
    });
    expect(bash(snapshots.at(-1))).not.toMatchObject({ preliminary: true });
  });
});
