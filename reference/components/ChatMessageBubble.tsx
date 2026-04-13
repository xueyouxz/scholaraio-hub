import { Check, Copy, Pencil, RotateCcw } from "lucide-react";
import type React from "react";
import type { MessageReference } from "../types/ui";
import ToolCallIndicator from "./ToolCallIndicator";
import ToolResultCard from "./ToolResultCard";

interface ChatMessageBubbleProps {
  message: MessageReference;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message }) => (
  <div
    className={`group flex flex-col gap-2.5 max-w-3xl ${
      message.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
    }`}
  >
    {message.attachments && message.attachments.length > 0 ? (
      <div className="mb-1 flex flex-wrap justify-end gap-2">
        {message.attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface/60"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="h-10 w-10 rounded-lg bg-surface-container-high flex items-center justify-center text-xs">
                {attachment.kind === "image" ? "IMG" : "DOC"}
              </span>
              <span className="max-w-44 truncate text-[11px] text-on-surface">
                {attachment.name}
              </span>
            </div>
          </div>
        ))}
      </div>
    ) : null}

    {message.editing ? (
      <div className="w-full max-w-full">
        <div className="w-full bg-primary-container text-on-primary-container rounded-[18px] rounded-tr-none px-5 py-3.5 font-sans text-sm">
          {message.content}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button className="px-3 py-1.5 text-xs rounded-lg text-on-surface-variant hover:bg-surface-container">
            取消
          </button>
          <button className="px-3 py-1.5 text-xs rounded-lg bg-primary text-on-primary">
            保存并重发
          </button>
        </div>
      </div>
    ) : (
      <div
        className={
          message.role === "user"
            ? "w-fit max-w-full px-[18px] py-3 bg-primary-container text-on-primary-container rounded-[18px] rounded-tr-none"
            : "w-full p-0 bg-transparent text-on-surface rounded-none border-none shadow-none"
        }
      >
        {message.role === "assistant" ? (
          <div className="space-y-3 w-full">
            {message.toolCalls?.map((call) => (
              <ToolCallIndicator
                key={call.toolName + call.status}
                toolName={call.toolName}
                status={call.status}
              />
            ))}
            {message.toolResults?.map((result, index) => (
              <ToolResultCard key={result.kind + index} result={result} />
            ))}
            <div className="prose prose-sm max-w-none">
              <p className="text-sm leading-7 text-on-surface">{message.content}</p>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none [&>p]:my-0">
            <p>{message.content}</p>
          </div>
        )}
      </div>
    )}

    {!message.editing ? (
      <div
        className={`flex w-full items-center gap-1 text-on-surface-variant/70 ${
          message.role === "user" ? "justify-end px-1" : "justify-start px-0"
        }`}
      >
        <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container">
          <Copy className="h-4 w-4" />
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container">
          <RotateCcw className="h-4 w-4" />
        </button>
        {message.role === "user" ? (
          <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container">
            <Pencil className="h-4 w-4" />
          </button>
        ) : (
          <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container">
            <Check className="h-4 w-4 text-primary" />
          </button>
        )}
      </div>
    ) : null}
  </div>
);

export default ChatMessageBubble;
