import { describe, expect, it } from "vitest";
import { type Emit, createSessionSubscription } from "../../src/subscriptions.js";
import type { Process } from "../../src/supervisor/Process.js";
import type { ProcessEvent } from "../../src/supervisor/types.js";

// Real (unmocked) augmenter is exercised here: the regression is in how the
// subscription serializes the stateful StreamCoordinator across delta bursts.

type Listener = (event: ProcessEvent) => void | Promise<void>;

function mockProcess(): { process: Process; fire: (e: ProcessEvent) => void } {
  let listener: Listener | null = null;
  const process = {
    id: "p1",
    sessionId: "s1",
    state: { type: "in-turn" },
    permissionMode: "default",
    modeVersion: 1,
    provider: "anthropic",
    resolvedModel: "claude-sonnet-4-5",
    subscribe: (fn: Listener) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    getMessageHistory: () => [],
    getStreamingContent: () => null,
    getDeferredQueueSummary: () => [],
  } as unknown as Process;
  // Fire synchronously without awaiting — mirrors Process.emit, which does not
  // await listeners, so a buffered delta burst hits back-to-back.
  return { process, fire: (e) => void listener?.(e) };
}

function collect(): { emit: Emit; events: Array<[string, unknown]> } {
  const events: Array<[string, unknown]> = [];
  return { emit: (type, data) => void events.push([type, data]), events };
}

const drain = () => new Promise((r) => setTimeout(r, 80));

function delta(text: string): ProcessEvent {
  return {
    type: "message",
    message: {
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    },
  } as ProcessEvent;
}

describe("streaming augmentation ordering", () => {
  it("keeps block indices strictly increasing under a synchronous delta burst", async () => {
    const { process, fire } = mockProcess();
    const { emit, events } = collect();
    createSessionSubscription(process, emit);

    fire({
      type: "message",
      message: {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_burst" } },
      },
    } as ProcessEvent);

    // A burst of deltas that close several markdown blocks (paragraph, heading,
    // code fence, table). Fired back-to-back with no microtask drain between —
    // the exact shape that previously collapsed every augment onto blockIndex 0.
    for (const chunk of [
      "Intro paragraph.\n\n",
      "## Heading A\n\n",
      "Lead-in then code:\n\n```ts\n",
      "const a = 1;\n",
      "```\n\n",
      "A table:\n\n| x | y |\n",
      "|---|---|\n",
      "| 1 | 2 |\n\n",
      "Trailing **bold** tail",
    ]) {
      fire(delta(chunk));
    }

    await drain();
    await drain();

    const augments = events
      .filter(([t]) => t === "markdown-augment")
      .map(
        ([, d]) => d as { blockIndex?: number; type?: string; html: string; messageId?: string },
      );
    const pendings = events
      .filter(([t]) => t === "pending")
      .map(([, d]) => d as { html: string; messageId?: string });

    // At least the paragraph, heading and code block must have closed.
    expect(augments.length).toBeGreaterThanOrEqual(3);

    const indices = augments.map((a) => a.blockIndex ?? -1);

    // Indices must be non-decreasing. (An optimistic streaming code/list block
    // legitimately shares its index with the closed version that replaces it, so
    // equal-adjacent is allowed — but the counter must never go backwards.)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1] as number);
    }

    // The core regression guard: the blockIndex counter must actually advance.
    // The bug collapsed every closed block onto index 0; here we require a
    // contiguous run 0,1,2,… proving distinct blocks land at distinct indices.
    const distinct = [...new Set(indices)].sort((a, b) => a - b);
    expect(distinct.length).toBeGreaterThanOrEqual(3);
    distinct.forEach((idx, i) => expect(idx).toBe(i));

    // The closed code block must be shiki-highlighted (not collapsed away).
    expect(augments.some((a) => a.html.includes("shiki"))).toBe(true);

    // Every augment/pending must carry the streaming message id.
    expect(augments.every((a) => a.messageId === "msg_burst")).toBe(true);
    expect(pendings.length).toBeGreaterThan(0);
    expect(pendings.every((p) => p.messageId === "msg_burst")).toBe(true);
  });
});
