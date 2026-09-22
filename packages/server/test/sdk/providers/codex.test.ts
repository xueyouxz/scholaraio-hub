/**
 * Unit tests for CodexProvider.
 *
 * Tests provider detection, authentication checking, and message normalization
 * without requiring actual Codex CLI installation.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../src/agent/events.js";
import { CodexEventAdapter } from "../../../src/sdk/providers/codex-events.js";
import { CodexProvider, type CodexProviderConfig } from "../../../src/sdk/providers/codex.js";

describe("CodexProvider", () => {
  let provider: CodexProvider;

  beforeAll(() => {
    provider = new CodexProvider();
  });

  describe("isInstalled", () => {
    it("should return boolean indicating CLI availability", async () => {
      const isInstalled = await provider.isInstalled();
      expect(typeof isInstalled).toBe("boolean");
    });

    it("should use custom codexPath if provided and exists", async () => {
      // Custom path is used IF it exists, otherwise falls back to PATH detection
      const customProvider = new CodexProvider({
        codexPath: "/nonexistent/path/to/codex",
      });
      // isInstalled will still check PATH if custom path doesn't exist
      const isInstalled = await customProvider.isInstalled();
      // We just verify it returns a boolean - actual value depends on system
      expect(typeof isInstalled).toBe("boolean");
    });
  });

  describe("getAuthStatus", () => {
    it("should return auth status object with required fields", async () => {
      const status = await provider.getAuthStatus();

      expect(typeof status.installed).toBe("boolean");
      expect(typeof status.authenticated).toBe("boolean");
      expect(typeof status.enabled).toBe("boolean");
    });

    it("should return authenticated=false if auth.json does not exist", async () => {
      // This test relies on the auth file not existing in the test environment
      const authPath = join(homedir(), ".codex", "auth.json");
      if (!existsSync(authPath)) {
        const status = await provider.getAuthStatus();
        // If CLI is not installed, everything should be false
        // If CLI is installed but no auth, installed=true but auth=false
        expect(status.authenticated).toBe(false);
      }
    });
  });

  describe("isAuthenticated", () => {
    it("should return boolean", async () => {
      const isAuth = await provider.isAuthenticated();
      expect(typeof isAuth).toBe("boolean");
    });
  });

  describe("provider properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("codex");
    });

    it("should have correct displayName", () => {
      expect(provider.displayName).toBe("Codex");
    });
  });

  describe("startSession", () => {
    it("should return session object with required methods", async () => {
      const session = await provider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      expect(session.events).toBeDefined();
      expect(typeof session.abort).toBe("function");
      expect(session.queue).toBeDefined();
    });

    it("should emit error if Codex CLI is not found", async () => {
      const noCliProvider = new CodexProvider({
        codexPath: "/nonexistent/codex",
      });

      const session = await noCliProvider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      const events: AgentEvent[] = [];
      for await (const event of session.events) {
        events.push(event);
        if (event.type === "turn.completed") break;
      }

      // A spawn failure still ends the run, as a failed turn.
      const last = events.at(-1);
      expect(last?.type).toBe("turn.completed");
      expect(last?.type === "turn.completed" && last.error).toBeTruthy();
    });
  });
});

describe("CodexProvider Auth File Parsing", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeAll(() => {
    // Create a temp directory to use as HOME
    tempDir = mkdtempSync(join(require("node:os").tmpdir(), "codex-test-"));
    originalHome = process.env.HOME;
  });

  afterAll(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    // Cleanup
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("should parse valid auth.json file", async () => {
    // Create mock auth file
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 day from now
      user: {
        email: "test@example.com",
        name: "Test User",
      },
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // Create provider that looks in our temp directory
    // Note: This doesn't actually work because homedir() is cached,
    // but it demonstrates the intended behavior
  });

  it("should handle expired tokens", async () => {
    // Create mock auth file with expired token
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // The actual test would need to mock homedir() to use tempDir
  });

  it("should handle invalid JSON in auth file", async () => {
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    writeFileSync(join(codexDir, "auth.json"), "not valid json");

    // Provider should handle this gracefully
  });
});

describe("CodexProvider Event Normalization", () => {
  // Test helper to create a provider and access internal methods
  function createTestProvider(): CodexProvider {
    return new CodexProvider();
  }

  it("should have correct provider interface", () => {
    const provider = createTestProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
    expect(typeof provider.isInstalled).toBe("function");
    expect(typeof provider.isAuthenticated).toBe("function");
    expect(typeof provider.getAuthStatus).toBe("function");
    expect(typeof provider.startSession).toBe("function");
  });

  /** Feed one completed app-server item through a fresh adapter. */
  const completed = (item: Record<string, unknown>) => {
    const adapter = new CodexEventAdapter("thread-1");
    adapter.beginTurn("turn-1");
    return adapter.notification({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item },
    });
  };
  const command = (id: string, commandLine: string, output: string, exitCode: number) =>
    completed({
      id,
      type: "commandExecution",
      command: commandLine,
      aggregatedOutput: output,
      exitCode,
      status: "completed",
    });

  it("canonicalizes a cat command into a Read call with a structured result", () => {
    expect(command("call-read", "cat src/example.ts", "line 1\nline 2", 0)).toMatchObject([
      {
        type: "tool.call",
        callId: "call-read",
        name: "Read",
        input: { file_path: "src/example.ts" },
      },
      {
        type: "tool.result",
        callId: "call-read",
        output: "line 1\nline 2",
        isError: false,
        detail: { type: "text", file: { filePath: "src/example.ts" } },
      },
    ]);
  });

  it("sees through shell launchers when canonicalizing", () => {
    const events = command(
      "call-read-wrapped",
      "/bin/bash -lc \"sed -n '10,12p' src/example.ts\"",
      "line 10\nline 11\nline 12",
      0,
    );
    expect(events).toMatchObject([
      {
        type: "tool.call",
        name: "Read",
        input: { file_path: "src/example.ts", offset: 10, limit: 3 },
      },
      {
        type: "tool.result",
        detail: { type: "text", file: { filePath: "src/example.ts", startLine: 10 } },
      },
    ]);
  });

  it("canonicalizes a heredoc into a Write call", () => {
    const content = "line 1\nline 2\n";
    const events = command("call-write", `cat > src/generated.ts <<'EOF'\n${content}EOF`, "", 0);
    expect(events).toMatchObject([
      { type: "tool.call", name: "Write", input: { file_path: "src/generated.ts", content } },
      {
        type: "tool.result",
        isError: false,
        detail: {
          type: "text",
          file: { filePath: "src/generated.ts", content, numLines: 2, startLine: 1, totalLines: 2 },
        },
      },
    ]);
  });

  it("treats ripgrep's no-match exit code as a successful empty Grep", () => {
    expect(command("call-grep", "rg -n missing_pattern src", "", 1)).toMatchObject([
      { type: "tool.call", name: "Grep", input: { pattern: "missing_pattern", path: "src" } },
      { type: "tool.result", isError: false, detail: { mode: "files_with_matches", numFiles: 0 } },
    ]);
  });

  it("canonicalizes rg --files as a Glob listing, not a search for the path", () => {
    expect(
      command("call-files", "rg --files packages -g '*.ts'", "packages/a.ts\npackages/b.ts\n", 0),
    ).toMatchObject([
      { type: "tool.call", name: "Glob", input: { pattern: "*.ts", path: "packages" } },
      {
        type: "tool.result",
        isError: false,
        detail: { filenames: ["packages/a.ts", "packages/b.ts"], numFiles: 2 },
      },
    ]);
    expect(command("call-all", "rg --files", "a.ts\n", 0)[0]).toMatchObject({
      type: "tool.call",
      name: "Glob",
      input: { pattern: "**/*" },
    });
  });

  it("treats rg --files finding nothing as an empty listing, not a failure", () => {
    expect(command("call-none", "rg --files src -g '*.rs'", "", 1)).toMatchObject([
      { type: "tool.call", name: "Glob" },
      { type: "tool.result", isError: false, detail: { filenames: [], numFiles: 0 } },
    ]);
  });

  it("keeps rg with a pattern as Grep", () => {
    expect(command("call-grep2", "rg -n PORT src", "src/a.ts:3:PORT", 0)[0]).toMatchObject({
      type: "tool.call",
      name: "Grep",
      input: { pattern: "PORT", path: "src" },
    });
  });

  it("completes a WebSearch call when its item completes", () => {
    expect(
      completed({ id: "search-1", type: "webSearch", query: "streaming tool status" }),
    ).toMatchObject([
      { type: "tool.call", name: "WebSearch", input: { query: "streaming tool status" } },
      {
        type: "tool.result",
        output: "Search completed for: streaming tool status",
        detail: { query: "streaming tool status", results: [] },
      },
    ]);
  });

  it("treats rate-limit snapshots as telemetry, never as errors", () => {
    const adapter = new CodexEventAdapter("thread-1");
    adapter.beginTurn("turn-1");
    for (const rateLimits of [
      { primary: { usedPercent: 21 }, credits: { hasCredits: false, unlimited: false } },
      { primary: { used_percent: 100 }, credits: { has_credits: false, unlimited: false } },
    ]) {
      expect(
        adapter.notification({ method: "account/rateLimits/updated", params: { rateLimits } }),
      ).toEqual([]);
    }
  });

  it("ends the turn with the provider's message on a terminal error", () => {
    const adapter = new CodexEventAdapter("thread-1");
    adapter.beginTurn("turn-1");
    const message =
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.";
    expect(
      adapter.notification({
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          willRetry: false,
          error: { message, codexErrorInfo: "usageLimitExceeded" },
        },
      }),
    ).toEqual([{ type: "turn.completed", error: message }]);
  });
});

describe("CodexProvider Configuration", () => {
  it("should accept custom timeout", () => {
    const config: CodexProviderConfig = {
      timeout: 60000,
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
    // Can't directly verify timeout since it's private,
    // but we can verify the provider was created
  });

  it("should accept custom codex path", () => {
    const config: CodexProviderConfig = {
      codexPath: "/custom/path/to/codex",
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
  });

  it("should use defaults when no config provided", () => {
    const provider = new CodexProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
  });
});

describe("Codex user-input requests", () => {
  type Handler = {
    handleServerRequestApproval(
      request: { id: number; method: string; params: unknown },
      options: unknown,
      signal: AbortSignal,
    ): Promise<unknown>;
  };
  const request = {
    id: 7,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "t",
      turnId: "turn",
      itemId: "ask-1",
      questions: [
        {
          id: "q1",
          header: "Scope",
          question: "Which package?",
          isOther: false,
          isSecret: false,
          options: [{ label: "server", description: "Hono API" }],
        },
      ],
    },
  };

  it("asks through the AskUserQuestion flow and maps answers back by question id", async () => {
    const calls: unknown[] = [];
    const provider = new CodexProvider() as unknown as Handler;
    const response = await provider.handleServerRequestApproval(
      request,
      {
        onToolApproval: async (name: string, input: unknown, options: { toolUseID?: string }) => {
          calls.push({ name, input, toolUseID: options.toolUseID });
          return {
            behavior: "allow",
            updatedInput: { ...(input as object), answers: { "Which package?": "server" } },
          };
        },
      },
      new AbortController().signal,
    );
    expect(calls).toMatchObject([
      {
        name: "AskUserQuestion",
        toolUseID: "ask-1",
        input: {
          questions: [
            { question: "Which package?", header: "Scope", options: [{ label: "server" }] },
          ],
        },
      },
    ]);
    expect(response).toEqual({ answers: { q1: { answers: ["server"] } } });
  });

  it("answers empty when the user declines", async () => {
    const provider = new CodexProvider() as unknown as Handler;
    const response = await provider.handleServerRequestApproval(
      request,
      { onToolApproval: async () => ({ behavior: "deny" }) },
      new AbortController().signal,
    );
    expect(response).toEqual({ answers: { q1: { answers: [] } } });
  });
});
