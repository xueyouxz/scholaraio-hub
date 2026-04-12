import type {
  AppSession,
  AppSessionSummary,
  InputRequest,
  NewSessionDefaults,
  PermissionMode,
  ProviderInfo,
  ProviderName,
  ThinkingOption,
  UploadedFile,
} from "@scholaraio-hub/shared";

export interface ProjectSummary {
  id: string;
  name?: string | null;
  path: string;
  provider: string;
  sessionCount: number;
  activeOwnedCount: number;
  activeExternalCount: number;
  lastActivity?: string | null;
}

export interface ProcessSummary {
  id: string;
  sessionId: string;
  sessionTitle?: string | null;
  projectId: string;
  projectName?: string;
  provider: ProviderName | string;
  state?: string | { type?: string } | null;
  model?: string | null;
  startedAt?: string;
  queueDepth?: number;
  permissionMode?: PermissionMode;
  terminationReason?: string;
}

export interface ServerSettings {
  globalInstructions?: string;
  newSessionDefaults?: NewSessionDefaults;
}

export interface SessionDetail {
  session: AppSession;
  messages: AppSession["messages"];
  ownership: AppSession["ownership"];
  pendingInputRequest?: InputRequest | null;
  slashCommands?: Array<{ name: string; description?: string }>;
  pagination?: {
    hasOlderMessages: boolean;
    totalMessageCount: number;
    returnedMessageCount: number;
    truncatedBeforeMessageId?: string;
    totalCompactions: number;
  };
}

export interface StartSessionInput {
  projectId: string;
  message: string;
  mode?: PermissionMode;
  model?: string;
  thinking?: ThinkingOption;
  provider?: ProviderName;
  attachments?: UploadedFile[];
}

export interface ResumeSessionInput extends StartSessionInput {
  sessionId: string;
}

export interface QueueMessageInput {
  sessionId: string;
  message: string;
  mode?: PermissionMode;
  thinking?: ThinkingOption;
  attachments?: UploadedFile[];
}

export interface CreateSessionInput {
  projectId: string;
  mode?: PermissionMode;
  model?: string;
  thinking?: ThinkingOption;
  provider?: ProviderName;
}

export interface SessionCreationResult {
  sessionId: string;
  processId: string;
  permissionMode?: PermissionMode;
  modeVersion?: number;
}

export type {
  AppSessionSummary,
  PermissionMode,
  ProviderInfo,
  ProviderName,
  ThinkingOption,
  UploadedFile,
};
