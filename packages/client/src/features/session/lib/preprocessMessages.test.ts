import { describe, expect, it } from "vitest";
import type { SessionContentBlock, SessionMessage } from "../model";
import { preprocessMessages } from "./preprocessMessages";

type ContentBlock = SessionContentBlock;
type Message = SessionMessage;

describe("preprocessMessages", () => {
  it("pairs tool_use with tool_result", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "test.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "file contents",
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "tool_group",
      toolName: "Read",
      tools: [
        {
          id: "tool-1",
          toolName: "Read",
          status: "complete",
          toolResult: { content: "file contents", isError: false },
        },
      ],
    });
  });

  it("preserves Agent tool summaries for rendering completed tasks", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Agent",
            input: {
              description: "Explore codebase for refactoring",
              prompt: "Find cleanup opportunities",
              subagent_type: "Explore",
            },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [
              {
                type: "text",
                text: "## Comprehensive Cleanup and Refactoring Opportunities Report",
              },
              {
                type: "text",
                text: "agentId: summary123\n<usage>total_tokens: 200\ntool_uses: 3\nduration_ms: 1000</usage>",
              },
            ],
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "tool_call",
      id: "tool-1",
      toolName: "Agent",
      status: "complete",
      toolResult: {
        isError: false,
        structured: {
          agentId: "summary123",
          status: "completed",
          content: [
            {
              type: "text",
              text: "## Comprehensive Cleanup and Refactoring Opportunities Report",
            },
          ],
          totalTokens: 200,
          totalToolUseCount: 3,
          totalDurationMs: 1000,
        },
      },
    });
  });

  it("marks tool_use as pending when result not yet received", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "tool_call",
      status: "pending",
      toolResult: undefined,
    });
  });

  it("deduplicates repeated tool_use blocks with the same id", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "Edit",
            input: { file_path: "a.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "Edit",
            input: { file_path: "a.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);
    const toolCalls = items.filter((item) => item.type === "tool_call");

    expect(toolCalls).toHaveLength(1);
    const call = toolCalls[0];
    if (call?.type === "tool_call") {
      expect(call.id).toBe("call_1");
      expect(call.status).toBe("pending");
    }
  });

  it("attaches tool_result to deduplicated tool_use", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "Edit",
            input: { file_path: "a.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "Edit",
            input: { file_path: "a.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-3",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: "success",
          },
        ],
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    const group = items[0];
    expect(group?.type).toBe("tool_group");
    if (group?.type === "tool_group") {
      expect(group.tools).toHaveLength(1);
      expect(group.tools[0]?.status).toBe("complete");
      expect(group.tools[0]?.toolResult?.content).toBe("success");
    }
  });

  it("handles multiple tool calls in sequence", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "a.ts" },
          },
          {
            type: "tool_use",
            id: "tool-2",
            name: "Read",
            input: { file_path: "b.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "contents a" },
          { type: "tool_result", tool_use_id: "tool-2", content: "contents b" },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    const group = items[0];
    expect(group?.type).toBe("tool_group");
    if (group?.type === "tool_group") {
      expect(group.tools).toHaveLength(2);
      expect(group.tools[0]?.status).toBe("complete");
      expect(group.tools[1]?.status).toBe("complete");
    }
  });

  it("links write_stdin calls to prior bash command using session id", () => {
    const messages: Message[] = [
      {
        id: "msg-bash-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "bash-1",
            name: "Bash",
            input: { command: "pnpm test" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-bash-result",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "bash-1",
            content: "Process running with session ID 29243",
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-stdin-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "stdin-1",
            name: "WriteStdin",
            input: { session_id: 29243, chars: "" },
          },
        ],
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    const items = preprocessMessages(messages);
    const writeStdinCall = items.find((item) => item.type === "tool_call" && item.id === "stdin-1");

    expect(writeStdinCall?.type).toBe("tool_call");
    if (writeStdinCall?.type === "tool_call") {
      expect(writeStdinCall.toolInput).toMatchObject({
        session_id: 29243,
        linked_command: "pnpm test",
      });
    }
  });

  it("links write_stdin calls to prior exec_command using session id", () => {
    const messages: Message[] = [
      {
        id: "msg-exec-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "exec-1",
            name: "exec_command",
            input: {
              cmd: "sed -n '1,140p' packages/client/src/layouts/NavigationLayout.tsx",
            },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-exec-result",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "exec-1",
            content: "Process running with session ID 70073",
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-stdin-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "stdin-1",
            name: "WriteStdin",
            input: { session_id: 70073, chars: "" },
          },
        ],
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    const items = preprocessMessages(messages);
    const writeStdinCall = items.find((item) => item.type === "tool_call" && item.id === "stdin-1");

    expect(writeStdinCall?.type).toBe("tool_call");
    if (writeStdinCall?.type === "tool_call") {
      expect(writeStdinCall.toolInput).toMatchObject({
        session_id: 70073,
        linked_command: "sed -n '1,140p' packages/client/src/layouts/NavigationLayout.tsx",
      });
    }
  });

  it("links write_stdin calls to prior Read tool using structured session id", () => {
    const messages: Message[] = [
      {
        id: "msg-read-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "read-1",
            name: "Read",
            input: {
              file_path: "packages/client/src/hooks/useGlobalSessions.ts",
              offset: 1,
              limit: 260,
            },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-read-result",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "read-1",
            content: "",
          },
        ],
        toolUseResult: {
          type: "text",
          file: {
            filePath: "packages/client/src/hooks/useGlobalSessions.ts",
            content: 'import { useCallback, useEffect, useRef, useState } from "react";\n',
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
          session_id: 37863,
        },
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-stdin-use",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "stdin-1",
            name: "WriteStdin",
            input: { session_id: 37863, chars: "" },
          },
        ],
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    const items = preprocessMessages(messages);
    const writeStdinCall = items.find((item) => item.type === "tool_call" && item.id === "stdin-1");

    expect(writeStdinCall?.type).toBe("tool_call");
    if (writeStdinCall?.type === "tool_call") {
      expect(writeStdinCall.toolInput).toMatchObject({
        session_id: 37863,
        linked_file_path: "packages/client/src/hooks/useGlobalSessions.ts",
        linked_tool_name: "Read",
      });
    }
  });

  it("preserves thinking blocks", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me analyze this..." },
          { type: "text", text: "Here is my response." },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(2);
    expect(items[0]?.type).toBe("thinking");
    expect(items[1]?.type).toBe("text");
  });

  it("handles user prompts with string content", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Hello, please help me",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "user_prompt",
      id: "msg-1",
      content: "Hello, please help me",
    });
  });

  it("collapses leading session setup prompts into one item", () => {
    const messages: Message[] = [
      {
        id: "msg-setup-1",
        role: "user",
        content: "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfoo",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-setup-2",
        role: "user",
        content: "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-user-1",
        role: "user",
        content: "Implement the requested change",
        timestamp: "2024-01-01T00:00:02Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "session_setup",
      title: "Session setup",
      prompts: [
        "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfoo",
        "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
      ],
    });
    expect(items[1]).toMatchObject({
      type: "user_prompt",
      content: "Implement the requested change",
    });
  });

  it("does not collapse a single setup-like prompt in the middle of a session", () => {
    const messages: Message[] = [
      {
        id: "msg-user-1",
        role: "user",
        content: "normal first prompt",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-setup-1",
        role: "user",
        content: "# AGENTS.md instructions for /repo",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "user_prompt",
      content: "normal first prompt",
    });
    expect(items[1]).toMatchObject({
      type: "user_prompt",
      content: "# AGENTS.md instructions for /repo",
    });
  });

  it("collapses repeated setup prompts inserted after resume", () => {
    const messages: Message[] = [
      {
        id: "msg-user-1",
        role: "user",
        content: "normal first prompt",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-setup-1",
        role: "user",
        content: "# AGENTS.md instructions for /repo",
        timestamp: "2024-01-01T00:00:01Z",
      },
      {
        id: "msg-setup-2",
        role: "user",
        content: "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
        timestamp: "2024-01-01T00:00:02Z",
      },
      {
        id: "msg-user-2",
        role: "user",
        content: "follow-up after resume",
        timestamp: "2024-01-01T00:00:03Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      type: "user_prompt",
      content: "normal first prompt",
    });
    expect(items[1]).toMatchObject({
      type: "session_setup",
      title: "Session setup",
      prompts: [
        "# AGENTS.md instructions for /repo",
        "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
      ],
    });
    expect(items[2]).toMatchObject({
      type: "user_prompt",
      content: "follow-up after resume",
    });
  });

  it("attaches markdown augment to assistant string content", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        type: "assistant",
        content: "Hello **world**",
        _html: "<p>Hello <strong>world</strong></p>",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "text",
      id: "msg-1",
      text: "Hello **world**",
      augmentHtml: "<p>Hello <strong>world</strong></p>",
    });
  });

  it("falls back to markdown augment map for assistant string content", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        type: "assistant",
        content: "Hello **world**",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages, {
      markdown: {
        "msg-1": { html: "<p>Hello <strong>world</strong></p>" },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "text",
      id: "msg-1",
      text: "Hello **world**",
      augmentHtml: "<p>Hello <strong>world</strong></p>",
    });
  });

  it("marks tool result as error when is_error is true", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "invalid" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "Command failed",
            is_error: true,
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "tool_group",
      tools: [
        {
          status: "error",
          toolResult: { content: "Command failed", isError: true },
        },
      ],
    });
  });

  it("skips empty text blocks", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "   " },
          { type: "text", text: "Actual content" },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "text",
      text: "Actual content",
    });
  });

  it("attaches structured tool result data", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "test.ts" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "file contents",
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
        toolUseResult: { lineCount: 42, filePath: "/test.ts" },
      },
    ];

    const items = preprocessMessages(messages);

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.type).toBe("tool_group");
    if (item?.type === "tool_group") {
      expect(item.tools[0]?.toolResult?.structured).toEqual({
        lineCount: 42,
        filePath: "/test.ts",
      });
    }
  });

  it("renders turn_aborted system messages", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        type: "system",
        subtype: "turn_aborted",
        content: "approval denied",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "system",
      subtype: "turn_aborted",
      content: "approval denied",
    });
  });

  it("renders provider error messages", () => {
    const messages: Message[] = [
      {
        id: "msg-err-1",
        type: "error",
        error: "Your refresh token was already used. Please sign in again.",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const items = preprocessMessages(messages);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "system",
      subtype: "error",
      content: "Your refresh token was already used. Please sign in again.",
    });
  });

  describe("tool group rendering items", () => {
    function readResult(filePath: string, numLines = 10) {
      return {
        type: "text",
        file: {
          filePath,
          content: "line\n".repeat(numLines),
          numLines,
          startLine: 1,
          totalLines: numLines,
        },
      };
    }

    function readMessages(
      ids: string[],
      options: {
        separator?: ContentBlock;
        ptyHandoff?: boolean;
        errorId?: string;
      } = {},
    ): Message[] {
      const content: ContentBlock[] = [];
      for (const id of ids) {
        content.push({
          type: "tool_use",
          id,
          name: "Read",
          input: { file_path: `${id}.ts` },
        });
        if (options.separator && id === ids[0]) {
          content.push(options.separator);
        }
      }

      return [
        {
          id: "msg-reads",
          role: "assistant",
          content,
          timestamp: "2024-01-01T00:00:00Z",
        },
        ...ids.map((id, index) => ({
          id: `msg-result-${id}`,
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: id,
              content: "",
              is_error: options.errorId === id,
            },
          ],
          timestamp: `2024-01-01T00:00:0${index + 1}Z`,
          toolUseResult:
            options.ptyHandoff && id === ids[0]
              ? {
                  type: "text",
                  file: {
                    filePath: `${id}.ts`,
                    content: "",
                    numLines: 0,
                    startLine: 1,
                    totalLines: 200,
                  },
                  session_id: 12345,
                }
              : readResult(`${id}.ts`, index + 1),
        })),
      ];
    }

    it("wraps a single terminal Read in a tool_group", () => {
      const items = preprocessMessages(readMessages(["one"]));

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        id: "tool-group-Read-one",
        toolName: "Read",
        tools: [{ id: "one", toolName: "Read", status: "complete" }],
      });
    });

    it("combines adjacent terminal Read calls into one tool_group", () => {
      const items = preprocessMessages(readMessages(["one", "two"]));

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        id: "tool-group-Read-one-two",
        toolName: "Read",
        tools: [
          { id: "one", toolName: "Read", status: "complete" },
          { id: "two", toolName: "Read", status: "complete" },
        ],
      });
    });

    it("does not combine Read calls across visible content", () => {
      const items = preprocessMessages(
        readMessages(["one", "two"], {
          separator: { type: "text", text: "Next I will read another file." },
        }),
      );

      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        tools: [{ id: "one" }],
      });
      expect(items[1]).toMatchObject({ type: "text" });
      expect(items[2]).toMatchObject({
        type: "tool_group",
        tools: [{ id: "two" }],
      });
    });

    it("groups errored and PTY handoff Read calls", () => {
      const errored = preprocessMessages(readMessages(["one"], { errorId: "one" }));
      const pty = preprocessMessages(readMessages(["one"], { ptyHandoff: true }));

      expect(errored[0]).toMatchObject({
        type: "tool_group",
        tools: [{ id: "one", status: "error" }],
      });
      expect(pty[0]).toMatchObject({
        type: "tool_group",
        tools: [{ id: "one", status: "complete" }],
      });
    });

    it("combines adjacent alias-equivalent tool names by canonical name", () => {
      const messages: Message[] = [
        {
          id: "msg-tools",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "bash-1",
              name: "exec_command",
              input: { cmd: "npm test" },
            },
            {
              type: "tool_use",
              id: "bash-2",
              name: "Bash",
              input: { command: "pnpm typecheck" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-result-1",
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "bash-1", content: "ok" },
            { type: "tool_result", tool_use_id: "bash-2", content: "ok" },
          ],
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const items = preprocessMessages(messages);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        toolName: "Bash",
        tools: [{ id: "bash-1" }, { id: "bash-2" }],
      });
    });

    it("does not group pending or inline tools", () => {
      const messages: Message[] = [
        {
          id: "msg-tools",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "pending-bash",
              name: "Bash",
              input: { command: "npm test" },
            },
            {
              type: "tool_use",
              id: "task-1",
              name: "Task",
              input: { description: "Explore", prompt: "Explore" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-task-result",
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "task-1", content: "done" }],
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const items = preprocessMessages(messages);

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        type: "tool_call",
        id: "pending-bash",
        status: "pending",
      });
      expect(items[1]).toMatchObject({
        type: "tool_call",
        id: "task-1",
        status: "complete",
      });
    });
  });

  describe("orphaned tool handling", () => {
    it("marks orphaned tool_use as aborted", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          orphanedToolUseIds: ["tool-1"],
        },
      ];

      const items = preprocessMessages(messages);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        id: "tool-group-Bash-tool-1",
        tools: [
          {
            id: "tool-1",
            status: "aborted",
            toolResult: undefined,
          },
        ],
      });
    });

    it("handles mix of orphaned and completed tools", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "a.ts" },
            },
            {
              type: "tool_use",
              id: "tool-2",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          orphanedToolUseIds: ["tool-2"], // only tool-2 is orphaned
        },
        {
          id: "msg-2",
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "file contents",
            },
          ],
          timestamp: "2024-01-01T00:00:01Z",
        },
      ];

      const items = preprocessMessages(messages);

      expect(items).toHaveLength(2);
      const tool1Group = items.find((i) => i.type === "tool_group" && i.toolName === "Read");
      const tool2Group = items.find((i) => i.type === "tool_group" && i.toolName === "Bash");

      expect(tool1Group?.type === "tool_group" && tool1Group.tools[0]?.status).toBe("complete");
      expect(tool2Group?.type === "tool_group" && tool2Group.tools[0]?.status).toBe("aborted");
    });

    it("non-orphaned pending tools remain pending", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          // No orphanedToolUseIds - tool is still pending (live conversation)
        },
      ];

      const items = preprocessMessages(messages);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_call",
        id: "tool-1",
        status: "pending",
      });
    });
  });

  describe("activeToolApproval handling", () => {
    it("treats all orphaned tools as pending when activeToolApproval is true", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          orphanedToolUseIds: ["tool-1"],
        },
      ];

      const items = preprocessMessages(messages, {
        activeToolApproval: true,
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_call",
        id: "tool-1",
        status: "pending", // Should be pending, not aborted
      });
    });

    it("still marks orphaned tools as aborted when activeToolApproval is false", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          orphanedToolUseIds: ["tool-1"],
        },
      ];

      const items = preprocessMessages(messages, {
        activeToolApproval: false,
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_group",
        id: "tool-group-Bash-tool-1",
        tools: [{ id: "tool-1", status: "aborted" }],
      });
    });

    it("treats multiple orphaned tools as pending when activeToolApproval is true", () => {
      // Scenario: batch of tool calls all queued for approval
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Edit",
              input: { file_path: "a.ts" },
            },
            {
              type: "tool_use",
              id: "tool-2",
              name: "Edit",
              input: { file_path: "b.ts" },
            },
            {
              type: "tool_use",
              id: "tool-3",
              name: "Edit",
              input: { file_path: "c.ts" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          orphanedToolUseIds: ["tool-1", "tool-2", "tool-3"],
        },
      ];

      const items = preprocessMessages(messages, {
        activeToolApproval: true,
      });

      expect(items).toHaveLength(3);
      // All should be pending, not aborted
      for (const item of items) {
        expect(item).toMatchObject({
          type: "tool_call",
          status: "pending",
        });
      }
    });

    it("handles activeToolApproval with no orphaned tools (no-op)", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
          // No orphanedToolUseIds
        },
      ];

      const items = preprocessMessages(messages, {
        activeToolApproval: true,
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "tool_call",
        id: "tool-1",
        status: "pending", // Already pending, stays pending
      });
    });
  });
});
