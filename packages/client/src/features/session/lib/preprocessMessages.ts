import type { MarkdownAugment, SessionContentBlock, SessionMessage } from "../model";
import { getMessageId } from "../model";
import type {
  RenderItem,
  SessionSetupItem,
  SystemItem,
  ToolCallItem,
  ToolResultData,
  UserPromptItem,
} from "../types/renderItems";

export type ActiveToolApproval = boolean;

export interface PreprocessAugments {
  markdown?: Record<string, MarkdownAugment>;
  activeToolApproval?: ActiveToolApproval;
}

/**
 * Preprocess raw SessionMessages into RenderItem[], pairing tool_use with
 * tool_result so a single ToolCallItem represents the full lifecycle.
 */
export function preprocessMessages(
  messages: SessionMessage[],
  augments?: PreprocessAugments,
): RenderItem[] {
  const items: RenderItem[] = [];
  const toolCallIndices = new Map<string, number>();
  const pendingToolCalls = new Map<string, number>();

  const orphanedToolIds = new Set<string>();
  if (!augments?.activeToolApproval) {
    for (const msg of messages) {
      const orphans = (msg as { orphanedToolUseIds?: unknown }).orphanedToolUseIds;
      if (Array.isArray(orphans)) {
        for (const id of orphans) {
          if (typeof id === "string") orphanedToolIds.add(id);
        }
      }
    }
  }

  for (const msg of messages) {
    processMessage(msg, items, toolCallIndices, pendingToolCalls, orphanedToolIds, augments);
  }

  return collapseSessionSetupRuns(items);
}

const SESSION_SETUP_PREFIXES = ["# AGENTS.md instructions", "<environment_context>"];

function getPromptText(content: string | SessionContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (block): block is SessionContentBlock & { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function isSessionSetupPrompt(item: UserPromptItem): boolean {
  const text = getPromptText(item.content).trimStart();
  return SESSION_SETUP_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function collapseSessionSetupRuns(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!item || item.type !== "user_prompt" || !isSessionSetupPrompt(item)) {
      if (item) result.push(item);
      index += 1;
      continue;
    }

    const setupItems: UserPromptItem[] = [];
    let runIndex = index;
    while (runIndex < items.length) {
      const runItem = items[runIndex];
      if (!runItem || runItem.type !== "user_prompt" || !isSessionSetupPrompt(runItem)) {
        break;
      }
      setupItems.push(runItem);
      runIndex += 1;
    }

    if (setupItems.length > 1 || index === 0) {
      const first = setupItems[0];
      if (!first) {
        index = runIndex;
        continue;
      }
      const collapsed: SessionSetupItem = {
        type: "session_setup",
        id: `session-setup-${first.id}`,
        title: "Session setup",
        prompts: setupItems.map((s) => s.content),
        sourceMessages: setupItems.flatMap((s) => s.sourceMessages),
      };
      result.push(collapsed);
    } else {
      const single = setupItems[0];
      if (single) result.push(single);
    }

    index = runIndex;
  }

  return result;
}

function processMessage(
  msg: SessionMessage,
  items: RenderItem[],
  toolCallIndices: Map<string, number>,
  pendingToolCalls: Map<string, number>,
  orphanedToolIds: Set<string>,
  augments?: PreprocessAugments,
): void {
  const msgId = getMessageId(msg);

  if (msg.type === "error") {
    const errorText =
      (typeof (msg as { error?: unknown }).error === "string" &&
        ((msg as { error: string }).error as string)) ||
      (typeof msg.content === "string" && (msg.content as string)) ||
      "Agent error";
    const sys: SystemItem = {
      type: "system",
      id: msgId || `error-${msg.timestamp ?? Date.now()}`,
      subtype: "error",
      content: errorText,
      sourceMessages: [msg],
    };
    items.push(sys);
    return;
  }

  if (msg.type === "system") {
    const subtype = (msg as { subtype?: string }).subtype ?? "unknown";
    if (subtype === "compact_boundary" || subtype === "turn_aborted") {
      const sys: SystemItem = {
        type: "system",
        id: msgId,
        subtype,
        content:
          typeof msg.content === "string"
            ? msg.content
            : subtype === "turn_aborted"
              ? "Turn aborted"
              : "Context compacted",
        sourceMessages: [msg],
      };
      items.push(sys);
    }
    return;
  }

  const content =
    (msg.message as { content?: string | SessionContentBlock[] } | undefined)?.content ??
    msg.content;

  const role = (msg.message as { role?: "user" | "assistant" } | undefined)?.role ?? msg.role;
  const isUserMessage = msg.type === "user" || role === "user";
  const isSubagent = (msg as { isSubagent?: boolean }).isSubagent;

  if (typeof content === "string") {
    if (isUserMessage) {
      items.push({
        type: "user_prompt",
        id: msgId,
        content,
        sourceMessages: [msg],
        isSubagent,
      });
      return;
    }
    if (content.trim()) {
      const messageHtml = msg._html;
      items.push({
        type: "text",
        id: msgId,
        text: content,
        sourceMessages: [msg],
        isSubagent,
        augmentHtml: messageHtml ?? augments?.markdown?.[msgId]?.html,
      });
    }
    return;
  }

  if (!Array.isArray(content)) {
    return;
  }

  const blockArray = content.filter(
    (b): b is SessionContentBlock => typeof b !== "string" && b !== null && typeof b === "object",
  );

  const isToolResultMessage =
    isUserMessage && blockArray.length > 0 && blockArray.every((b) => b.type === "tool_result");

  if (isToolResultMessage) {
    for (const block of blockArray) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        attachToolResult(block, msg, items, pendingToolCalls);
      }
    }
    return;
  }

  if (isUserMessage) {
    items.push({
      type: "user_prompt",
      id: msgId,
      content: blockArray,
      sourceMessages: [msg],
      isSubagent,
    });
    return;
  }

  let lastTextBlockIndex = -1;
  if (msg._isStreaming) {
    for (let i = blockArray.length - 1; i >= 0; i--) {
      const block = blockArray[i];
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        lastTextBlockIndex = i;
        break;
      }
    }
  }

  for (let i = 0; i < blockArray.length; i++) {
    const block = blockArray[i];
    if (!block) continue;

    const blockId = `${msgId}-${i}`;

    if (block.type === "text") {
      if (typeof block.text === "string" && block.text.trim()) {
        const blockHtml = block._html;
        items.push({
          type: "text",
          id: blockId,
          text: block.text,
          sourceMessages: [msg],
          isSubagent,
          isStreaming: Boolean(msg._isStreaming) && i === lastTextBlockIndex,
          augmentHtml: blockHtml ?? augments?.markdown?.[msgId]?.html,
        });
      }
    } else if (block.type === "thinking") {
      if (typeof block.thinking === "string" && block.thinking.trim()) {
        items.push({
          type: "thinking",
          id: blockId,
          thinking: block.thinking,
          signature: typeof block.signature === "string" ? block.signature : undefined,
          status: msg._isStreaming ? "streaming" : "complete",
          sourceMessages: [msg],
          isSubagent,
        });
      }
    } else if (block.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : undefined;
      const name = typeof block.name === "string" ? block.name : undefined;
      if (id && name) {
        const existingIndex = toolCallIndices.get(id);
        if (existingIndex !== undefined) {
          const existing = items[existingIndex];
          if (existing?.type === "tool_call") {
            items[existingIndex] = appendSourceMessage(existing, msg);
            if (existing.status === "pending") {
              pendingToolCalls.set(id, existingIndex);
            }
          }
          continue;
        }

        const isOrphaned = orphanedToolIds.has(id);
        const toolCall: ToolCallItem = {
          type: "tool_call",
          id,
          toolName: name,
          toolInput: block.input,
          toolResult: undefined,
          status: isOrphaned ? "aborted" : "pending",
          sourceMessages: [msg],
          isSubagent,
        };
        const itemIndex = items.length;
        toolCallIndices.set(id, itemIndex);
        pendingToolCalls.set(id, itemIndex);
        items.push(toolCall);
      }
    }
  }
}

function appendSourceMessage(item: ToolCallItem, message: SessionMessage): ToolCallItem {
  const messageId = getMessageId(message);
  if (item.sourceMessages.some((source) => getMessageId(source) === messageId)) {
    return item;
  }
  return {
    ...item,
    sourceMessages: [...item.sourceMessages, message],
  };
}

function attachToolResult(
  block: SessionContentBlock,
  resultMessage: SessionMessage,
  items: RenderItem[],
  pendingToolCalls: Map<string, number>,
): void {
  const toolUseId = block.tool_use_id;
  if (typeof toolUseId !== "string") return;

  const index = pendingToolCalls.get(toolUseId);
  if (index === undefined) {
    return;
  }

  const item = items[index];
  if (!item || item.type !== "tool_call") return;

  const structured =
    (resultMessage as { toolUseResult?: unknown }).toolUseResult ??
    (resultMessage as Record<string, unknown>).tool_use_result;

  const isError = Boolean(block.is_error);
  const resultData: ToolResultData = {
    content: typeof block.content === "string" ? block.content : "",
    isError,
    structured,
  };

  const updatedItem: ToolCallItem = {
    type: "tool_call",
    id: item.id,
    toolName: item.toolName,
    toolInput: item.toolInput,
    toolResult: resultData,
    status: isError ? "error" : "complete",
    sourceMessages: appendSourceMessage(item, resultMessage).sourceMessages,
    isSubagent: item.isSubagent,
  };

  items[index] = updatedItem;
  pendingToolCalls.delete(toolUseId);
}
