import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { ClaudeEventAdapter } from "../../../src/providers/claude/ClaudeEventAdapter.js";
import type { SDKMessage } from "../../../src/providers/claude/sdk-message.js";
import type { AgentEvent } from "../../../src/providers/events.js";
import { UIChunkWriter } from "../../../src/sessions/UIChunkWriter.js";

/**
 * Golden-file coverage for the Claude conversion pipeline, as the Codex one
 * pins its own: Agent SDK message -> AgentEvent -> UIMessageChunk. The
 * fixtures follow what Claude Code sends — one API message split into
 * one-block assistant messages, stream events before them, subagent traffic
 * tagged with its Task call, and the system messages the hub shows.
 *
 * To check against a real session, record one with LOG_SDK_MESSAGES and add
 * its lines (with private content replaced) as another fixture.
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
  for (const name of ["split-turn", "subagent-turn", "system-turn"]) {
    it(`converts ${name} into a stable event and chunk stream`, () => {
      const { messages } = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8")) as {
        messages: SDKMessage[];
      };
      compareWithGolden(name, convert(messages));
    });
  }
});
