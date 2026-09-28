/**
 * Claude Code's own session history: the sessions it has filed under
 * `~/.claude/projects`, and each one's conversation, read through the Agent
 * SDK (`listSessions`, `getSessionMessages`) rather than by parsing the files.
 */

import { homedir } from "node:os";
import path from "node:path";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../events.js";
import type { HistoryFiles, NativeSession, NativeTurn, ReadSessionOptions } from "../types.js";
import { ClaudeEventAdapter } from "./ClaudeEventAdapter.js";
import type { SDKMessage } from "./sdk-message.js";

/** Markers Claude Code writes as user messages that the user did not type. */
const NON_PROMPT_PREFIXES = [
  "[Request interrupted",
  "<local-command",
  "<command-message>",
  "Caveat: The messages below",
];

/** How Claude Code opens the summary it continues from after compacting. */
const COMPACTED_PREFIX = "This session is being continued from a previous conversation";

/** A transcript message as `getSessionMessages` returns it; the SDK leaves `message` untyped. */
export interface TranscriptMessage {
  type: string;
  uuid: string;
  message: unknown;
  /** Present at runtime, though the SDK's type leaves it out. */
  timestamp?: unknown;
}

/** The text blocks of a user message, joined. */
function userText(message: TranscriptMessage): string | undefined {
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const blocks = content as Array<{ type?: unknown; text?: unknown }>;
  if (blocks.some((block) => block.type === "tool_result")) return undefined;
  const texts = blocks.filter((block) => block.type === "text").map((block) => String(block.text));
  return texts.length ? texts.join("\n") : undefined;
}

/** A slash command the user ran, as Claude Code records it: `<command-name>/x</command-name>`. */
function commandOf(text: string): string | undefined {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim();
  if (!name) return undefined;
  const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

/**
 * What the user sent in this message, or undefined for a message the user did
 * not type: a tool result, an interrupt marker, a local command's echo.
 */
export function promptOf(message: TranscriptMessage): string | undefined {
  if (message.type !== "user") return undefined;
  const text = userText(message);
  if (text === undefined) return undefined;
  const command = commandOf(text);
  if (command) return command;
  const start = text.trimStart();
  if (start.startsWith(COMPACTED_PREFIX)) return undefined;
  if (NON_PROMPT_PREFIXES.some((prefix) => start.startsWith(prefix))) return undefined;
  return text;
}

/** Whether the message is the summary Claude Code continues from after compacting. */
function isCompactionSummary(message: TranscriptMessage): boolean {
  return (
    message.type === "user" && Boolean(userText(message)?.trimStart().startsWith(COMPACTED_PREFIX))
  );
}

function iso(value: unknown): string | undefined {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  return undefined;
}

/** Every session Claude Code has filed, in every directory. */
export async function listClaudeSessions(): Promise<NativeSession[]> {
  const sessions = await listSessions();
  return sessions.flatMap((session) => {
    if (!session.cwd) return [];
    const updatedAt = new Date(session.lastModified).toISOString();
    return [
      {
        id: session.sessionId,
        cwd: session.cwd,
        title: session.customTitle || session.summary || session.firstPrompt || "",
        createdAt: iso(session.createdAt) ?? updatedAt,
        updatedAt,
        ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
      },
    ];
  });
}

/**
 * The session's messages up to a pending rewind's resume point: the
 * transcript still holds the dropped turns after it until the next launch
 * resumes there.
 */
export async function claudeTranscript(
  sessionId: string,
  { cwd, resumeAt }: ReadSessionOptions,
): Promise<TranscriptMessage[]> {
  const messages = (await getSessionMessages(sessionId, { dir: cwd })) as TranscriptMessage[];
  if (!resumeAt) return messages;
  const end = messages.findIndex((message) => message.uuid === resumeAt);
  if (end < 0) throw new Error("The rewind point is no longer in the Claude session history");
  return messages.slice(0, end + 1);
}

/**
 * The conversation as turns. Claude Code keeps only what followed its last
 * compaction in the conversation it resumes; that summary opens the history
 * as a notice instead of a prompt.
 */
export function claudeTurns(messages: TranscriptMessage[]): NativeTurn[] {
  const turns: NativeTurn[] = [];
  let adapter = new ClaudeEventAdapter();
  let current: NativeTurn | undefined;
  const close = () => {
    if (current) current.events.push({ type: "turn.completed" });
  };
  for (const message of messages) {
    const prompt = promptOf(message);
    if (prompt !== undefined || isCompactionSummary(message)) {
      close();
      adapter = new ClaudeEventAdapter();
      current = { id: message.uuid, prompt: prompt ?? "", events: [] };
      const at = iso(message.timestamp);
      if (at) current.at = at;
      if (prompt === undefined) current.events.push(compactionNotice(message.uuid));
      turns.push(current);
      continue;
    }
    // Before any prompt (a session that starts mid-way): nothing to hang it on.
    if (!current) continue;
    const events: AgentEvent[] = adapter.accept(message as unknown as SDKMessage);
    // A replayed transcript has no live session: its markers are not news.
    current.events.push(...events.filter((event) => event.type !== "session.started"));
  }
  close();
  return turns;
}

function compactionNotice(uuid: string): AgentEvent {
  return {
    type: "notice",
    key: `compacted-${uuid}`,
    level: "info",
    text: "Earlier messages were compacted by Claude Code; the conversation continues from its summary.",
  };
}

/** A session transcript: `<project folder>/<session id>.jsonl`. Subagents' are in subfolders. */
const TRANSCRIPT =
  /^[^/\\]+[/\\]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Where Claude Code files its transcripts: `$CLAUDE_CONFIG_DIR/projects`, by default under `~/.claude`. */
export function claudeHistoryFiles(env: Record<string, string | undefined>): HistoryFiles {
  return {
    directory: path.join(env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "projects"),
    sessionOf: (file) => file.match(TRANSCRIPT)?.[1],
  };
}
