import type { UIMessage } from "ai";
import { z } from "zod";
import type { InputRequest } from "../app-types.js";
import type { LibraryCitation } from "../library.js";

export type SessionMessage = UIMessage<never, { citations: LibraryCitation[]; notice: string }>;
export interface StoredSession {
  id: string;
  title: string;
  provider: "claude" | "codex";
  model?: string;
  paperIds: string[];
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
  state: "idle" | "running" | "waiting-input" | "interrupted" | "error";
  error?: string;
  pendingInput?: InputRequest;
  messages: SessionMessage[];
}
export const CreateSessionSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  model: z.string().max(200).optional(),
  paperIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  title: z.string().trim().min(1).max(200).default("新会话"),
});
export const SendSessionMessageSchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(50000),
});
