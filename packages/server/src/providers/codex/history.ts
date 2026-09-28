/**
 * Codex's own session history, read through app-server: `thread/list` for the
 * threads it has stored, `thread/read` for one thread's turns. Each stored
 * turn is replayed through the live event adapter, so history and a running
 * turn reach the browser in the same shape.
 */

import { homedir } from "node:os";
import path from "node:path";
import type { HistoryFiles, NativeSession, NativeTurn } from "../types.js";
import type { CodexAppServerClient } from "./CodexAppServerClient.js";
import { CodexEventAdapter } from "./CodexEventAdapter.js";
import type {
  Thread,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadSourceKind,
  UserInput,
} from "./protocol/index.js";

/**
 * Threads a person had a conversation in. `thread/list` offers only
 * interactive sources unless asked; the Hub's own threads (`appServer`) are
 * asked for too. `exec` runs are scripts, and subagents belong to their parent.
 */
const LISTED_SOURCES: ThreadSourceKind[] = ["cli", "vscode", "appServer"];
const PAGE_SIZE = 200;

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function toNativeSession(thread: Thread): NativeSession {
  return {
    id: thread.id,
    cwd: thread.cwd,
    title: thread.name || thread.preview,
    createdAt: iso(thread.createdAt),
    updatedAt: iso(thread.updatedAt),
    ...(thread.gitInfo?.branch ? { gitBranch: thread.gitInfo.branch } : {}),
  };
}

/**
 * Every thread Codex has stored, from its state database: every model
 * provider (an omitted filter means only the configured one), newest first.
 */
export async function listCodexThreads(client: CodexAppServerClient): Promise<NativeSession[]> {
  const sessions: NativeSession[] = [];
  let cursor: string | null = null;
  do {
    const params: ThreadListParams = {
      cursor,
      limit: PAGE_SIZE,
      sortKey: "updated_at",
      modelProviders: [],
      sourceKinds: LISTED_SOURCES,
      useStateDbOnly: true,
    };
    const page: ThreadListResponse = await client.request("thread/list", params);
    for (const thread of page.data)
      if (!thread.parentThreadId && !thread.ephemeral) sessions.push(toNativeSession(thread));
    cursor = page.nextCursor;
  } while (cursor);
  return sessions;
}

/** The text a user message carried; images and mentions are left out. */
function promptText(input: UserInput[]): string {
  return input
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/** A stored thread's turns, each replayed from its completed items. */
export async function readCodexThread(
  client: CodexAppServerClient,
  threadId: string,
): Promise<NativeTurn[]> {
  const params: ThreadReadParams = { threadId, includeTurns: true };
  const { thread }: ThreadReadResponse = await client.request("thread/read", params);
  const adapter = new CodexEventAdapter(threadId);
  return thread.turns.map((turn) => {
    const prompt = turn.items.flatMap((item) =>
      item.type === "userMessage" ? [promptText(item.content)] : [],
    );
    adapter.beginTurn(turn.id);
    const events = turn.items.flatMap((item) =>
      item.type === "userMessage"
        ? []
        : adapter.notification({
            method: "item/completed",
            params: { threadId, turnId: turn.id, item },
          }),
    );
    const failure =
      turn.status === "failed" ? (turn.error?.message ?? "Codex turn failed") : undefined;
    events.push(...adapter.completeTurn(failure));
    return {
      id: turn.id,
      prompt: prompt.join("\n"),
      ...(turn.startedAt ? { at: iso(turn.startedAt) } : {}),
      events,
    };
  });
}

/** A rollout file: `rollout-<timestamp>-<thread id>.jsonl`, compressed or not. */
const ROLLOUT =
  /(?:^|[/\\])rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i;

/** Where Codex writes rollouts: `$CODEX_HOME/sessions`, by default under `~/.codex`. */
export function codexHistoryFiles(env: Record<string, string | undefined>): HistoryFiles {
  return {
    directory: path.join(env.CODEX_HOME || path.join(homedir(), ".codex"), "sessions"),
    sessionOf: (file) => file.match(ROLLOUT)?.[1],
  };
}
