import { randomUUID } from "node:crypto";
import type { SessionMessage } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import type { SDKMessage } from "../sdk/types.js";
import { SessionMessageNormalizer } from "./SessionMessageNormalizer.js";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Explicit uploaded histories only. Never enumerates provider home directories. */
export async function importHistory(
  content: string,
  provider: "claude" | "codex",
): Promise<SessionMessage[]> {
  const lines = content.split("\n").filter((line) => line.trim());
  const entries = lines.map((line, index) => {
    try {
      return object(JSON.parse(line));
    } catch {
      throw new SyntaxError(`历史文件第 ${index + 1} 行不是有效 JSON。`);
    }
  });
  const result: SessionMessage[] = [];
  let chunks: UIMessageChunk[] = [];
  let normalizer = new SessionMessageNormalizer((chunk) => chunks.push(chunk));
  async function flush() {
    if (!chunks.length) return;
    normalizer.finish();
    const current = [
      { type: "start" as const, messageId: randomUUID() },
      ...chunks,
      { type: "finish" as const },
    ];
    let last: SessionMessage | undefined;
    for await (const message of readUIMessageStream<SessionMessage>({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of current) controller.enqueue(chunk);
          controller.close();
        },
      }),
      terminateOnError: true,
    }))
      last = message;
    if (last) result.push(last);
    chunks = [];
    normalizer = new SessionMessageNormalizer((chunk) => chunks.push(chunk));
  }
  for (const entry of entries) {
    let message: SDKMessage | undefined;
    if (provider === "claude") {
      if (["user", "assistant"].includes(String(entry.type)) && entry.message)
        message = entry as unknown as SDKMessage;
    } else if (entry.type === "response_item") {
      const payload = object(entry.payload);
      if (payload.type === "message") {
        const content = Array.isArray(payload.content)
          ? payload.content.map((part) => object(part).text ?? "").join("\n")
          : String(payload.content ?? "");
        message = {
          type: String(payload.role),
          uuid: typeof payload.id === "string" ? payload.id : randomUUID(),
          message: { content },
        };
      } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
        let input: unknown = payload.input ?? payload.arguments;
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch {
            input = { text: input };
          }
        }
        message = {
          type: "assistant",
          uuid: randomUUID(),
          message: {
            content: [
              { type: "tool_use", id: String(payload.call_id), name: String(payload.name), input },
            ],
          },
        };
      } else if (
        payload.type === "function_call_output" ||
        payload.type === "custom_tool_call_output"
      ) {
        message = {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: String(payload.call_id),
                content: String(payload.output),
              },
            ],
          },
        };
      }
    }
    if (!message) continue;
    const body = message.message?.content;
    const isUser =
      message.type === "user" &&
      (typeof body === "string" ||
        (Array.isArray(body) && body.some((part) => part.type === "text")));
    if (isUser) {
      await flush();
      const text =
        typeof body === "string"
          ? body
          : (body
              ?.filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n") ?? "");
      result.push({ id: randomUUID(), role: "user", parts: [{ type: "text", text }] });
    } else normalizer.accept(message);
  }
  await flush();
  if (!result.length)
    throw new SyntaxError("没有找到可导入的会话消息，请检查文件与 AI 工具是否对应。");
  return result;
}
