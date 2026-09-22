import type { AssistantEntry } from "./entry/AssistantEntrySchema.js";
import type { SystemEntry } from "./entry/SystemEntrySchema.js";
import type { UserEntry } from "./entry/UserEntrySchema.js";
import type { ClaudeSessionEntry } from "./index.js";

/** Check if entry is a compact_boundary system entry */
export function isCompactBoundary(
  entry: ClaudeSessionEntry,
): entry is SystemEntry & { subtype: "compact_boundary" } {
  return entry.type === "system" && "subtype" in entry && entry.subtype === "compact_boundary";
}

/** Check if entry is a conversation entry (has message field) */
export function isConversationEntry(
  entry: ClaudeSessionEntry,
): entry is UserEntry | AssistantEntry {
  return entry.type === "user" || entry.type === "assistant";
}
