import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SDKMessage } from "../../src/providers/claude/sdk-message.js";
import { CodexProvider } from "../../src/providers/codex/CodexProvider.js";

const FOREGROUND = process.env.FOREGROUND === "1";

function log(...args: unknown[]) {
  if (FOREGROUND) {
    console.log(...args);
  }
}

function logMessage(message: SDKMessage) {
  if (!FOREGROUND) return;

  const subtype = (message as { subtype?: string }).subtype;
  console.log(`[${message.type}${subtype ? `:${subtype}` : ""}]`);

  if (message.type === "assistant" || message.type === "user") {
    const content = message.message?.content;
    if (typeof content === "string") {
      console.log(`  ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") {
          console.log(`  ${block.text.slice(0, 200)}${block.text.length > 200 ? "..." : ""}`);
        } else if (block?.type === "tool_use") {
          console.log(`  [tool_use] ${block.name}`);
        } else if (block?.type === "tool_result") {
          console.log("  [tool_result]");
        }
      }
    }
  }
}

describe("Codex Real E2E", () => {
  let provider: CodexProvider;
  let testDir: string;
  let codexAvailable = false;

  beforeAll(async () => {
    if (process.env.REAL_CODEX_TESTS !== "true") {
      console.log("Skipping Codex real tests - set REAL_CODEX_TESTS=true to enable");
      return;
    }

    provider = new CodexProvider();

    const status = await provider.getAuthStatus();
    if (!status.installed) {
      console.log("Skipping Codex real tests - Codex CLI not installed");
      return;
    }

    if (!status.authenticated) {
      console.log("Skipping Codex real tests - Codex CLI not authenticated");
      return;
    }

    codexAvailable = true;
    testDir = mkdtempSync(join(tmpdir(), "scholaraio-hub-codex-e2e-"));
    writeFileSync(join(testDir, "prompt.txt"), "hello from codex test");
  });

  afterAll(() => {
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("should accept a prompt and return messages", async () => {
    if (!codexAvailable) {
      return;
    }

    const prompt =
      process.env.CODEX_E2E_PROMPT ?? "Read prompt.txt and reply with a short acknowledgement.";

    const session = await provider.startSession({
      cwd: testDir,
      initialMessage: { text: prompt },
      permissionMode: "bypassPermissions",
    });

    const messages: SDKMessage[] = [];
    const timeout = setTimeout(() => session.abort(), 60000);

    try {
      for await (const message of session.iterator) {
        messages.push(message);
        logMessage(message);

        if (message.type === "result" || message.type === "error") {
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const transcriptPath = join(testDir, "codex-e2e-messages.json");
    writeFileSync(transcriptPath, JSON.stringify(messages, null, 2));

    log(`[codex-e2e] prompt: ${prompt}`);
    log(`[codex-e2e] transcript: ${transcriptPath}`);
    log(`[codex-e2e] message count: ${messages.length}`);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.type === "result" || m.type === "error")).toBe(true);
  }, 90000);
});
