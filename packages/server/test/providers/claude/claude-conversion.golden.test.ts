import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeEventAdapter } from "../../../src/providers/claude/ClaudeEventAdapter.js";
import type { SDKMessage } from "../../../src/providers/claude/sdk-message.js";
import type { AgentEvent } from "../../../src/providers/events.js";
import { UIChunkWriter } from "../../../src/sessions/UIChunkWriter.js";

/**
 * Golden-file coverage for the Claude conversion pipeline, as the Codex one
 * pins its own: Agent SDK message -> AgentEvent -> UIMessageChunk.
 *
 * `recorded-turn` is a real turn (its `recorded` field says which CLI, SDK
 * and prompt), taken with LOG_SDK_MESSAGES and sanitized: one API message split
 * into one-block assistant messages after its stream events, summarized
 * thinking, a subagent run through the `Agent` tool, and the CLI's task and
 * rate-limit messages. `system-turn` is written by hand: API retries,
 * compaction and a failed API call cannot be produced on demand.
 *
 * To re-record after a CLI or SDK upgrade, trace one turn the same way and
 * replace `recorded-turn.json` (dropping hook messages, the init message's
 * local configuration, signatures, and replacing ids and paths).
 *
 * Regenerate after an intentional change, then format:
 *   UPDATE_GOLDEN=1 pnpm --filter @scholaraio-hub/server test claude-conversion
 *   pnpm lint:fix
 */

const FIXTURES = fileURLToPath(new URL("../../fixtures/claude-sdk/", import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function convert(messages: SDKMessage[]): { events: AgentEvent[]; chunks: UIMessageChunk[] } {
  const adapter = new ClaudeEventAdapter();
  const events = messages.flatMap((message) => adapter.accept(message));
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

describe("claude message conversion", () => {
  // Rate-limit events are stamped with the time they were read.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const name of ["recorded-turn", "system-turn"]) {
    it(`converts ${name} into a stable event and chunk stream`, () => {
      const { messages } = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8")) as {
        messages: SDKMessage[];
      };
      compareWithGolden(name, convert(messages));
    });
  }
});
