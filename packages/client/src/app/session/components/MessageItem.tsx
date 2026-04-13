import { Brain, CheckCircle2, Wrench, XCircle } from "lucide-react";
import {
  type SessionContent,
  type SessionContentBlock,
  type SessionMessage,
  getMessageRole,
} from "../model";
import { TextBlock } from "./TextBlock";

interface MessageItemProps {
  message: SessionMessage;
  augmentHtml?: string;
}

function blockText(content: SessionContent | null): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" && typeof block.text === "string") return block.text;
      if (block?.type === "thinking" && typeof block.thinking === "string") return block.thinking;
      if (block?.type === "tool_use" && typeof block.name === "string")
        return `[tool_use] ${block.name}`;
      if (block?.type === "tool_result") {
        return typeof block.content === "string"
          ? `[tool_result]\n${block.content}`
          : "[tool_result]";
      }
      return typeof block?.text === "string" ? block.text : `[${block?.type ?? "content"}]`;
    })
    .join("\n\n");
}

function messageContent(message: SessionMessage): SessionContent | null {
  if (typeof message.content === "string" || Array.isArray(message.content)) {
    return message.content;
  }
  const nested = message.message as { content?: SessionContent } | undefined;
  if (typeof nested?.content === "string" || Array.isArray(nested?.content)) {
    return nested.content;
  }
  return null;
}

function blockKey(block: SessionContentBlock | string, index: number): string {
  if (typeof block === "string") {
    return `text-${block.slice(0, 24)}-${block.length}`;
  }
  return String(block.id ?? block.tool_use_id ?? block.name ?? block.type ?? index);
}

function renderAssistantBlock(block: SessionContentBlock, index: number, isStreaming: boolean) {
  const key = blockKey(block, index);

  if (block.type === "text") {
    return (
      <TextBlock
        key={key}
        text={block.text ?? ""}
        augmentHtml={typeof block._html === "string" ? block._html : undefined}
        isStreaming={isStreaming}
        timelineItem
      />
    );
  }

  if (block.type === "thinking") {
    return (
      <details key={key} className="thinking-block collapsible timeline-item">
        <summary className="collapsible__summary">
          <span className="collapsible__icon">▶</span>
          <Brain className="w-3.5 h-3.5 opacity-60 shrink-0" />
          <span>Thinking</span>
        </summary>
        <div className="collapsible__content">
          <div className="text-content">{block.thinking ?? ""}</div>
        </div>
      </details>
    );
  }

  if (block.type === "tool_use") {
    return (
      <div key={key} className="tool-row timeline-item status-complete">
        <div className="tool-row-header">
          <Wrench className="w-3.5 h-3.5 shrink-0 opacity-70" />
          <strong>{block.name ?? "Tool"}</strong>
        </div>
        <div className="tool-row-body">
          <pre>{JSON.stringify(block.input ?? {}, null, 2)}</pre>
        </div>
      </div>
    );
  }

  if (block.type === "tool_result") {
    const content =
      typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
    return (
      <div
        key={key}
        className={`tool-row timeline-item ${block.is_error ? "status-error" : "status-complete"}`}
      >
        <div className="tool-row-header">
          {block.is_error ? (
            <XCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          )}
          <strong>{block.is_error ? "Tool Error" : "Tool Result"}</strong>
        </div>
        <div className="tool-row-body">
          <pre>{content}</pre>
        </div>
      </div>
    );
  }

  return (
    <div key={key} className="tool-row timeline-item status-complete">
      <div className="tool-row-header">
        <Wrench className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <strong>{block.type ?? "Content"}</strong>
      </div>
      <div className="tool-row-body">
        <pre>{JSON.stringify(block, null, 2)}</pre>
      </div>
    </div>
  );
}

export function MessageItem({ message, augmentHtml }: MessageItemProps) {
  const role = getMessageRole(message) ?? "assistant";
  const content = messageContent(message);
  const isStreaming = Boolean(message._isStreaming);
  const isUser = role === "user";
  const text = blockText(content);
  const timestamp =
    typeof message.timestamp === "string" ? new Date(message.timestamp).toLocaleString() : null;

  if (isUser) {
    return (
      <div className="flex justify-start">
        <div className="w-fit max-w-[min(80%,820px)] px-[18px] py-3 bg-surface-container-high text-on-surface rounded-[18px] rounded-tl-none border border-outline-variant/20">
          {Array.isArray(content) ? (
            <div className="whitespace-pre-wrap break-words">
              {content.map((block, index) =>
                typeof block === "string" ? (
                  <TextBlock key={blockKey(block, index)} text={block} />
                ) : (
                  <TextBlock key={blockKey(block, index)} text={block.text ?? blockText([block])} />
                ),
              )}
            </div>
          ) : (
            <p className="text-sm leading-relaxed m-0">{text}</p>
          )}
          {timestamp ? (
            <div className="mt-1 text-[11px] text-on-surface-variant/60">{timestamp}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {Array.isArray(content) && !isStreaming ? (
        <>
          {content.map((block, index) =>
            typeof block === "string" ? (
              <TextBlock key={blockKey(block, index)} text={block} timelineItem />
            ) : (
              renderAssistantBlock(block, index, isStreaming)
            ),
          )}
          {timestamp ? (
            <div className="mt-1 text-[11px] text-on-surface-variant/60">{timestamp}</div>
          ) : null}
        </>
      ) : (
        <>
          <TextBlock text={text} augmentHtml={augmentHtml} isStreaming={isStreaming} timelineItem />
          {timestamp ? (
            <div className="mt-1 text-[11px] text-on-surface-variant/60">{timestamp}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
