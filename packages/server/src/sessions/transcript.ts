/**
 * A session's conversation as the browser shows it: the provider's own turns
 * (see `AgentProvider.readSession`), each prompt as the user wrote it and each
 * answer with what the Hub added to it (citations, notices, metadata).
 */

import type { SessionMessage, SessionNotice } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import type { NativeTurn } from "../providers/types.js";
import { attachmentUrl } from "./SessionAttachments.js";
import type { PromptRecord } from "./SessionStore.js";
import { UIChunkWriter } from "./UIChunkWriter.js";
import { userText } from "./agent-prompt.js";

/**
 * The messages of the session `key`'s turns, ending before the turn whose
 * prompt is `until` (one still running).
 */
export async function transcript(
  turns: NativeTurn[],
  prompts: Record<string, PromptRecord>,
  key: string,
  until?: string,
): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];
  for (const turn of turns) {
    if (until && turn.id === until) break;
    const prompt = prompts[turn.id];
    const user = prompt ? recordedPrompt(prompt, key) : nativePrompt(turn);
    if (user) messages.push(user);
    const reply = await answer(turn, prompt);
    if (reply?.parts.length) messages.push(reply);
  }
  return messages;
}

/** The prompt the Hub sent in the session `key`, as the user wrote it. */
export function recordedPrompt(
  prompt: Pick<PromptRecord, "inputId" | "text" | "files">,
  key: string,
): SessionMessage {
  return {
    id: prompt.inputId,
    role: "user",
    parts: [
      ...(prompt.text ? [{ type: "text" as const, text: prompt.text }] : []),
      ...prompt.files.map((file) => ({
        type: "file" as const,
        mediaType: file.mediaType,
        filename: file.filename,
        url: attachmentUrl(key, file.id),
      })),
    ],
  };
}

/** A prompt the Hub has no record of (sent from a terminal, or before it kept one), as the user wrote it. */
function nativePrompt(turn: NativeTurn): SessionMessage | undefined {
  const text = userText(turn.prompt);
  if (!text) return undefined;
  return { id: turn.id, role: "user", parts: [{ type: "text", text }] };
}

/** The agent's side of a turn, written the way a live turn streams it. */
async function answer(
  turn: NativeTurn,
  prompt: PromptRecord | undefined,
): Promise<SessionMessage | undefined> {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: prompt?.replyId ?? `${turn.id}:reply` },
  ];
  const writer = new UIChunkWriter((chunk) => chunks.push(chunk));
  if (prompt?.citations)
    chunks.push({ type: "data-citations", id: "citations", data: prompt.citations });
  let failure: string | undefined;
  for (const event of turn.events) {
    if (event.type === "turn.completed") failure = event.error;
    writer.write(event);
  }
  writer.close();
  // The Hub's notices for a prompt it sent include how the turn failed.
  const notices: SessionNotice[] =
    prompt?.notices ?? (failure ? [{ level: "error", text: failure }] : []);
  notices.forEach((notice, index) => {
    chunks.push({ type: "data-notice", id: `notice-${index}`, data: notice });
  });
  if (prompt?.metadata) chunks.push({ type: "message-metadata", messageMetadata: prompt.metadata });
  chunks.push({ type: "finish" });
  // A turn stopped short may have left nothing in the transcript; what it had
  // shown by then is the answer.
  const answered = turn.events.some((event) => ANSWER_EVENTS.has(event.type));
  if (!answered && prompt?.reply)
    return {
      id: prompt.replyId,
      role: "assistant",
      parts: prompt.reply,
      ...(prompt.metadata ? { metadata: prompt.metadata } : {}),
    };
  return assemble(chunks);
}

/** Events that put something in an answer, as opposed to bookkeeping. */
const ANSWER_EVENTS = new Set<string>([
  "text.delta",
  "reasoning.delta",
  "tool.call",
  "tool.call.invalid",
  "tool.result",
  "file",
]);

/** The message a stream of UI chunks writes. */
export async function assemble(chunks: UIMessageChunk[]): Promise<SessionMessage | undefined> {
  let message: SessionMessage | undefined;
  for await (const state of readUIMessageStream<SessionMessage>({
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  }))
    message = state;
  return message;
}
