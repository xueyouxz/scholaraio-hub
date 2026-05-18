import { memo, useCallback } from "react";
import { useUiStore } from "../store/uiStore";
import type { RenderItem } from "../types/renderItems";
import { SessionSetupBlock } from "./SessionSetupBlock";
import { TextBlock } from "./TextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallRow } from "./ToolCallRow";
import { ToolGroupBlock } from "./ToolGroupBlock";
import { UserPromptBlock } from "./UserPromptBlock";

interface Props {
  item: RenderItem;
  sessionProvider?: string;
}

function getMessageIdLike(message: Record<string, unknown>): string {
  if (typeof message.uuid === "string" && message.uuid.length > 0) return message.uuid;
  if (typeof message.id === "string" && message.id.length > 0) return message.id;
  return "<missing>";
}

function summarizeSourceMessages(messages: RenderItem["sourceMessages"]) {
  const bySource: Record<string, number> = { sdk: 0, jsonl: 0, unknown: 0 };
  const byType: Record<string, number> = {};
  const ids: string[] = [];
  let streamEventCount = 0;
  let streamingPlaceholderCount = 0;

  for (const message of messages) {
    const source =
      message._source === "sdk" || message._source === "jsonl" ? message._source : "unknown";
    bySource[source] = (bySource[source] ?? 0) + 1;
    const type = typeof message.type === "string" ? message.type : "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
    if (type === "stream_event") streamEventCount++;
    if (message._isStreaming) streamingPlaceholderCount++;
    ids.push(getMessageIdLike(message as Record<string, unknown>));
  }

  return {
    total: messages.length,
    bySource,
    byType,
    streamEventCount,
    streamingPlaceholderCount,
    ids,
  };
}

function buildDebugSnapshot(item: RenderItem, props: { sessionProvider?: string }) {
  return {
    render: { id: item.id, type: item.type, isSubagent: item.isSubagent ?? false },
    uiContext: { sessionProvider: props.sessionProvider ?? "unknown" },
    itemContext:
      item.type === "tool_call"
        ? {
            toolName: item.toolName,
            status: item.status,
            hasToolResult: Boolean(item.toolResult),
            hasStructuredResult: item.toolResult?.structured !== undefined,
            toolUseId: item.id,
          }
        : item.type === "tool_group"
          ? {
              toolName: item.toolName,
              toolCount: item.tools.length,
              toolIds: item.tools.map((tool) => tool.id),
            }
          : item.type === "text"
            ? {
                isStreamingTextBlock: item.isStreaming ?? false,
                hasAugmentHtml: Boolean(item.augmentHtml),
              }
            : item.type === "thinking"
              ? { status: item.status, thinkingLength: item.thinking.length }
              : item.type === "system"
                ? { subtype: item.subtype, status: item.status ?? null }
                : item.type === "session_setup"
                  ? { promptCount: item.prompts.length }
                  : null,
    sourceSummary: summarizeSourceMessages(item.sourceMessages),
    sourceMessages: item.sourceMessages,
    renderItem: item,
  };
}

export const RenderItemComponent = memo(function RenderItemComponent({
  item,
  sessionProvider,
}: Props) {
  const thinkingExpanded = useUiStore((state) => state.thinkingExpanded);
  const toggleThinkingExpanded = useUiStore((state) => state.toggleThinkingExpanded);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        console.log("[DEBUG] Render snapshot", buildDebugSnapshot(item, { sessionProvider }));
      }
    },
    [item, sessionProvider],
  );

  const content = renderContent(item, {
    thinkingExpanded,
    toggleThinkingExpanded,
    sessionProvider,
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Shift+click debug logging is not a primary interaction.
    <div
      className={item.isSubagent ? "subagent-item" : undefined}
      data-render-type={item.type}
      data-render-id={item.id}
      onClick={handleClick}
    >
      {content}
    </div>
  );
});

function renderContent(
  item: RenderItem,
  ctx: {
    thinkingExpanded: boolean;
    toggleThinkingExpanded: () => void;
    sessionProvider?: string;
  },
) {
  switch (item.type) {
    case "text":
      return (
        <TextBlock text={item.text} isStreaming={item.isStreaming} augmentHtml={item.augmentHtml} />
      );

    case "thinking":
      return (
        <ThinkingBlock
          thinking={item.thinking}
          status={item.status}
          isExpanded={ctx.thinkingExpanded}
          onToggle={ctx.toggleThinkingExpanded}
        />
      );

    case "tool_call":
      return (
        <ToolCallRow
          id={item.id}
          toolName={item.toolName}
          toolInput={item.toolInput}
          toolResult={item.toolResult}
          status={item.status}
          sessionProvider={ctx.sessionProvider}
        />
      );

    case "tool_group":
      return (
        <ToolGroupBlock
          toolName={item.toolName}
          tools={item.tools}
          sessionProvider={ctx.sessionProvider}
        />
      );

    case "user_prompt":
      return <UserPromptBlock content={item.content} />;

    case "session_setup":
      return <SessionSetupBlock title={item.title} prompts={item.prompts} />;

    case "system": {
      const isCompacting = item.subtype === "status" && item.status === "compacting";
      const isError = item.subtype === "error";
      const icon = isError ? "!" : "⟳";
      return (
        <div
          className={`system-message ${isCompacting ? "system-message-compacting" : ""} ${isError ? "system-message-error" : ""}`}
        >
          <span className={`system-message-icon ${isCompacting ? "spinning" : ""}`}>{icon}</span>
          <span className="system-message-text">{item.content}</span>
        </div>
      );
    }

    default:
      return null;
  }
}
