import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import {
  type TokenUsageSnapshot,
  convertNotificationToSDKMessages,
  extractTurnUsage,
} from "../../src/sdk/providers/codex-events.js";
import type { SDKMessage } from "../../src/sdk/types.js";
import { SessionMessageNormalizer } from "../../src/sessions/SessionMessageNormalizer.js";

/**
 * Golden-file coverage for the Codex conversion pipeline.
 *
 * The contract under test is the whole path an app-server notification travels
 * before it reaches the browser: JSON-RPC notification -> SDKMessage ->
 * UIMessageChunk. Asserting the chunk stream (rather than the intermediate
 * SDKMessage shape) keeps these tests valid while that middle representation is
 * refactored.
 *
 * Regenerate after an intentional change: UPDATE_GOLDEN=1 pnpm --filter
 * @scholaraio-hub/server test codex-conversion
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/codex-notifications/", import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface NotificationFixture {
  sessionId: string;
  notifications: { method: string; params?: unknown }[];
}

function convert(fixture: NotificationFixture): {
  messages: SDKMessage[];
  chunks: UIMessageChunk[];
} {
  const usageByTurnId = new Map<string, TokenUsageSnapshot>();
  const messages: SDKMessage[] = [];
  const chunks: UIMessageChunk[] = [];
  const normalizer = new SessionMessageNormalizer((chunk) => chunks.push(chunk));
  for (const notification of fixture.notifications) {
    if (notification.method === "thread/tokenUsage/updated") {
      const usage = extractTurnUsage(notification.params);
      if (usage) usageByTurnId.set(usage.turnId, usage.snapshot);
    }
    for (const message of convertNotificationToSDKMessages(
      notification,
      fixture.sessionId,
      usageByTurnId,
    )) {
      // `timestamp` is wall-clock and would make the golden file unstable.
      const { timestamp: _timestamp, ...stable } = message;
      messages.push(stable as SDKMessage);
      normalizer.accept(message);
    }
  }
  normalizer.finish();
  return { messages, chunks };
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
  for (const name of ["agent-turn", "tool-turn", "failed-turn"]) {
    it(`converts ${name} into a stable chunk stream`, () => {
      const fixture = JSON.parse(
        readFileSync(join(FIXTURES, `${name}.json`), "utf-8"),
      ) as NotificationFixture;
      const { messages, chunks } = convert(fixture);
      compareWithGolden(name, { messages, chunks });
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
});
