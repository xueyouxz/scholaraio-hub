import { memo, useMemo, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { toolRegistry } from "../renderers/tools";
import { getToolGroupMetadata } from "../renderers/tools/toolMetadata";
import type { RenderContext } from "../renderers/types";
import type { ToolCallItem } from "../types/renderItems";

interface Props {
  toolName: string;
  tools: ToolCallItem[];
  sessionProvider?: string;
}

function getToolResult(tool: ToolCallItem): unknown {
  return tool.toolResult?.structured ?? tool.toolResult?.content;
}

function isFailed(tool: ToolCallItem): boolean {
  return tool.status === "error" || tool.toolResult?.isError === true;
}

function isInterrupted(tool: ToolCallItem): boolean {
  return tool.status === "aborted";
}

function safeSummary(tool: ToolCallItem): string {
  const renderer = toolRegistry.get(tool.toolName);
  try {
    const inputSummary = renderer.getUseSummary?.(tool.toolInput);
    if (inputSummary) {
      return inputSummary;
    }
  } catch {
    // Fall through to generic label.
  }
  return toolRegistry.getDisplayName(tool.toolName);
}

function fallbackGroupItemLabel(tool: ToolCallItem): string {
  const renderer = toolRegistry.get(tool.toolName);
  const result = getToolResult(tool);

  try {
    const useSummary = renderer.getUseSummary?.(tool.toolInput);
    const resultSummary = renderer.getResultSummary?.(result, isFailed(tool), tool.toolInput);
    if (useSummary && resultSummary) {
      return `${useSummary} -> ${resultSummary}`;
    }
    return useSummary || resultSummary || toolRegistry.getDisplayName(tool.toolName);
  } catch {
    return toolRegistry.getDisplayName(tool.toolName);
  }
}

function ToolGroupDetail({
  tool,
  context,
}: {
  tool: ToolCallItem;
  context: RenderContext;
}) {
  const result = getToolResult(tool);
  const itemContext = { ...context, toolUseId: tool.id };

  return (
    <div className="tool-group-detail">
      <div className="tool-group-detail-section">
        <div className="tool-group-detail-label">Input</div>
        {toolRegistry.renderToolUse(tool.toolName, tool.toolInput, itemContext)}
      </div>
      {tool.toolResult && (
        <div className="tool-group-detail-section">
          <div className="tool-group-detail-label">Result</div>
          {toolRegistry.renderToolResult(
            tool.toolName,
            result,
            isFailed(tool),
            itemContext,
            tool.toolInput,
          )}
        </div>
      )}
    </div>
  );
}

export const ToolGroupBlock = memo(function ToolGroupBlock({
  toolName,
  tools,
  sessionProvider,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolCallItem | null>(null);
  const metadata = getToolGroupMetadata(toolName);
  const unit = tools.length === 1 ? metadata.singular : metadata.plural;
  const displayName = toolRegistry.getDisplayName(toolName);
  const failedCount = tools.filter(isFailed).length;
  const interruptedCount = tools.filter(isInterrupted).length;
  const title = `${displayName} ${tools.length} ${unit}`;

  const renderContext: RenderContext = useMemo(
    () => ({
      isStreaming: false,
      theme: "light",
      provider: sessionProvider,
    }),
    [sessionProvider],
  );

  const toggleExpanded = () => {
    setExpanded((current) => !current);
  };

  return (
    <div
      className={`tool-group-block timeline-item ${expanded ? "expanded" : "collapsed"} ${failedCount > 0 ? "status-error" : interruptedCount > 0 ? "status-aborted" : "status-complete"}`}
    >
      <button
        type="button"
        className="tool-group-header"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <span className="tool-group-title">{title}</span>
        <span className="tool-group-chevron" aria-hidden="true" />
        <span className="tool-group-status">
          {failedCount > 0 && <span>{failedCount} failed</span>}
          {interruptedCount > 0 && <span>{interruptedCount} interrupted</span>}
        </span>
      </button>

      {expanded && (
        <ul className="tool-group-list">
          {tools.map((tool) => {
            const renderer = toolRegistry.get(tool.toolName);
            const result = getToolResult(tool);
            const itemContext = { ...renderContext, toolUseId: tool.id };
            const renderedItem = renderer.renderGroupItem?.(
              {
                id: tool.id,
                toolName: tool.toolName,
                input: tool.toolInput,
                result,
                isError: isFailed(tool),
                status: tool.status,
              },
              itemContext,
            );

            return (
              <li className="tool-group-item" key={tool.id}>
                <div className="tool-group-item-main">
                  {renderedItem ?? (
                    <button
                      type="button"
                      className="tool-group-item-button"
                      onClick={() => setSelectedTool(tool)}
                      title={safeSummary(tool)}
                    >
                      {fallbackGroupItemLabel(tool)}
                    </button>
                  )}
                </div>
                {(isFailed(tool) || isInterrupted(tool)) && (
                  <span className="tool-group-item-status">
                    {isFailed(tool) ? "failed" : "interrupted"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selectedTool && (
        <Modal
          title={`${toolRegistry.getDisplayName(selectedTool.toolName)}: ${safeSummary(selectedTool)}`}
          onClose={() => setSelectedTool(null)}
        >
          <ToolGroupDetail tool={selectedTool} context={renderContext} />
        </Modal>
      )}
    </div>
  );
});
