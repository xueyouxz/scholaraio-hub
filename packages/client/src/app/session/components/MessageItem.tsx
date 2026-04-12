import {
  type SessionContent,
  type SessionContentBlock,
  type SessionMessage,
  getMessageId,
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
      if (typeof block === "string") {
        return block;
      }
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block?.type === "thinking" && typeof block.thinking === "string") {
        return block.thinking;
      }
      if (block?.type === "tool_use" && typeof block.name === "string") {
        return `[tool_use] ${block.name}`;
      }
      if (block?.type === "tool_result") {
        if (typeof block.content === "string") {
          return `[tool_result]\n${block.content}`;
        }
        return "[tool_result]";
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

function renderBlock(block: SessionContentBlock, index: number, isStreaming: boolean) {
  const key = blockKey(block, index);
  if (block.type === "text") {
    return (
      <TextBlock
        key={key}
        text={block.text ?? ""}
        augmentHtml={typeof block._html === "string" ? block._html : undefined}
        isStreaming={isStreaming}
      />
    );
  }
  if (block.type === "thinking") {
    return (
      <details key={key} className="session-thinking-block">
        <summary>Thinking</summary>
        <pre>{block.thinking ?? ""}</pre>
      </details>
    );
  }
  if (block.type === "tool_use") {
    return (
      <div key={key} className="session-inline-block tool-block">
        <strong>{block.name ?? "Tool"}</strong>
        <pre>{JSON.stringify(block.input ?? {}, null, 2)}</pre>
      </div>
    );
  }
  if (block.type === "tool_result") {
    const content =
      typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    return (
      <div key={key} className="session-inline-block tool-result-block">
        <strong>{block.is_error ? "Tool Error" : "Tool Result"}</strong>
        <pre>{content}</pre>
      </div>
    );
  }
  return (
    <div key={key} className="session-inline-block">
      <pre>{JSON.stringify(block, null, 2)}</pre>
    </div>
  );
}

export function MessageItem({ message, augmentHtml }: MessageItemProps) {
  const id = getMessageId(message);
  const role = getMessageRole(message) ?? "assistant";
  const content = messageContent(message);
  const isStreaming = Boolean(message._isStreaming);
  const isUser = role === "user";
  const text = blockText(content);

  return (
    <article
      key={id}
      className={`session-message ${isUser ? "user" : "assistant"}${isStreaming ? " streaming" : ""}`}
    >
      <div className="session-message-meta">
        <span className="message-role">{role}</span>
        {typeof message.timestamp === "string" ? (
          <span>{new Date(message.timestamp).toLocaleString()}</span>
        ) : null}
      </div>
      {Array.isArray(content) && !isStreaming ? (
        <div className="session-message-body">
          {content.map((block, index) =>
            typeof block === "string" ? (
              <TextBlock key={blockKey(block, index)} text={block} />
            ) : (
              renderBlock(block, index, isStreaming)
            ),
          )}
        </div>
      ) : (
        <TextBlock text={text} augmentHtml={augmentHtml} isStreaming={isStreaming} />
      )}
    </article>
  );
}
