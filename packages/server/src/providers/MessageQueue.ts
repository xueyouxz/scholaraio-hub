import type { UploadedFile } from "@scholaraio-hub/shared";
import { AsyncQueue } from "./AsyncQueue.js";
import type { UserMessage } from "./types.js";

/** Image types and size a model accepts inline; larger or other files are read from disk. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function isInlineImage(file: UploadedFile): boolean {
  return INLINE_IMAGE_TYPES.has(file.mimeType) && file.size <= INLINE_IMAGE_MAX_BYTES;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The text an agent reads about uploaded files: where each one is, to open with its tools. */
export function describeAttachments(attachments: UploadedFile[] = []): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map(
    (file) => `- ${file.originalName} (${formatSize(file.size)}, ${file.mimeType}): ${file.path}`,
  );
  return `\n\nUser uploaded files:\n${lines.join("\n")}`;
}

/**
 * The user messages a provider session takes, in order. Each provider turns
 * them into its own input; closing the queue ends that input, and a reader
 * waiting for the next message stops.
 */
export class MessageQueue {
  private readonly items = new AsyncQueue<UserMessage>();

  push(message: UserMessage): void {
    this.items.push(message);
  }

  close(): void {
    this.items.close();
  }

  async *messages(): AsyncGenerator<UserMessage> {
    while (true) {
      try {
        yield await this.items.shift();
      } catch (error) {
        if (this.items.closed) return;
        throw error;
      }
    }
  }
}
