import { memo } from "react";
import { useUiStore } from "../store/uiStore";
import type { RenderItem } from "../types/renderItems";
import { SessionSetupBlock } from "./SessionSetupBlock";
import { TextBlock } from "./TextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallRow } from "./ToolCallRow";
import { UserPromptBlock } from "./UserPromptBlock";

interface Props {
  item: RenderItem;
  sessionProvider?: string;
}

export const RenderItemComponent = memo(function RenderItemComponent({
  item,
  sessionProvider,
}: Props) {
  const thinkingExpanded = useUiStore((state) => state.thinkingExpanded);
  const toggleThinkingExpanded = useUiStore((state) => state.toggleThinkingExpanded);

  const content = renderContent(item, {
    thinkingExpanded,
    toggleThinkingExpanded,
    sessionProvider,
  });

  return (
    <div
      className={item.isSubagent ? "subagent-item" : undefined}
      data-render-type={item.type}
      data-render-id={item.id}
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
        <TextBlock
          text={item.text}
          isStreaming={item.isStreaming}
          augmentHtml={item.augmentHtml}
          timelineItem
        />
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
