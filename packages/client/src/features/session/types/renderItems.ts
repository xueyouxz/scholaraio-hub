import type { SessionContentBlock, SessionMessage } from "../model";

export type RenderItem =
  | TextItem
  | ThinkingItem
  | ToolCallItem
  | ToolGroupItem
  | UserPromptItem
  | SessionSetupItem
  | SystemItem;

interface RenderItemBase {
  sourceMessages: SessionMessage[];
  isSubagent?: boolean;
}

export interface TextItem extends RenderItemBase {
  type: "text";
  id: string;
  text: string;
  isStreaming?: boolean;
  augmentHtml?: string;
}

export interface ThinkingItem extends RenderItemBase {
  type: "thinking";
  id: string;
  thinking: string;
  signature?: string;
  status: "streaming" | "complete";
}

export interface ToolCallItem extends RenderItemBase {
  type: "tool_call";
  id: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResultData;
  status: "pending" | "complete" | "error" | "aborted";
}

export interface ToolResultData {
  content: string;
  isError: boolean;
  structured?: unknown;
}

export interface ToolGroupItem extends RenderItemBase {
  type: "tool_group";
  id: string;
  toolName: string;
  tools: ToolCallItem[];
}

export interface UserPromptItem extends RenderItemBase {
  type: "user_prompt";
  id: string;
  content: string | SessionContentBlock[];
}

export interface SessionSetupItem extends RenderItemBase {
  type: "session_setup";
  id: string;
  title: string;
  prompts: Array<string | SessionContentBlock[]>;
}

export interface SystemItem extends RenderItemBase {
  type: "system";
  id: string;
  subtype: "compact_boundary" | "status" | "init" | "error" | "turn_aborted" | string;
  content: string;
  status?: "compacting" | null;
}
