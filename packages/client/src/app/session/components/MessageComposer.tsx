import type { ModelInfo, ThinkingOption } from "../../../core/types";
import { MessageInput } from "./MessageInput";

interface MessageComposerProps {
  message: string;
  thinking: ThinkingOption;
  busy: boolean;
  files: File[];
  model?: string;
  models?: ModelInfo[];
  onMessageChange: (value: string) => void;
  onThinkingChange: (value: ThinkingOption) => void;
  onFilesChange: (files: File[]) => void;
  onModelChange?: (model: string) => void;
  onSend: () => Promise<void>;
}

export function MessageComposer(props: MessageComposerProps) {
  return <MessageInput {...props} />;
}
