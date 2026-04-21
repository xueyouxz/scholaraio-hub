import type { ReactNode } from "react";

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown;
  is_error?: boolean;
}

export interface RenderContext {
  isStreaming: boolean;
  theme: "light" | "dark";
  toolUseId?: string;
  getToolUse?: (id: string) => { name: string; input: unknown } | undefined;
  toolUseResult?: unknown;
  thinkingExpanded?: boolean;
  toggleThinkingExpanded?: () => void;
  provider?: string;
}

export interface ContentRenderer<T extends ContentBlock = ContentBlock> {
  type: string | string[];
  render(block: T, context: RenderContext): ReactNode;
  getSummary?(block: T): string;
}
