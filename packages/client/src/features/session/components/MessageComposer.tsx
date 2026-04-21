import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import type { ModelInfo, ThinkingOption } from "../../../core/types";
import { MessageInput } from "./MessageInput";

interface SlashCommand {
  name: string;
  description?: string;
}

interface MessageComposerProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  files: File[];
  model?: string;
  models?: ModelInfo[];
  permissionMode?: PermissionMode;
  isHeld?: boolean;
  draftKey?: string;
  slashCommands?: SlashCommand[];
  supportsPermissionMode?: boolean;
  contextUsage?: ContextUsage;
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onFilesChange: (files: File[]) => void;
  onModelChange?: (model: string) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onHoldChange?: (held: boolean) => void;
  onSend: () => Promise<void>;
}

export function MessageComposer(props: MessageComposerProps) {
  return <MessageInput {...props} />;
}
