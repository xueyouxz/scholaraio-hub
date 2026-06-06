import type { SDKMessage } from "../sdk/types.js";

/**
 * Normalize a provider/SDK stream message into a consistent shape before it
 * enters the Process message history and the SSE stream.
 *
 * Applied once at ingestion (rather than in the transport/subscription layer)
 * so that live emits and history replay observe the same normalized shape.
 *
 * Currently only aliases Codex's camelCase `toolUseResult` onto the canonical
 * `tool_use_result` field on user messages, so downstream augmentation and the
 * client read a single field regardless of provider. Non-mutating: returns the
 * same reference when nothing changes.
 */
export function normalizeProviderStreamMessage<T extends SDKMessage>(message: T): T {
  if (
    message.type === "user" &&
    message.tool_use_result === undefined &&
    message.toolUseResult !== undefined
  ) {
    return { ...message, tool_use_result: message.toolUseResult };
  }
  return message;
}
