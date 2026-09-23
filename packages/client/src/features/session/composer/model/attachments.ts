import { ATTACHMENT_LIMITS, type ProviderCapabilities } from "@scholaraio-hub/shared";

export type AttachmentLimits = ProviderCapabilities["attachments"];

/** Why these files cannot be added to a message that already has `currentCount`, if at all. */
export function rejectAttachments(
  currentCount: number,
  incoming: Pick<File, "size">[],
  limits: AttachmentLimits = ATTACHMENT_LIMITS,
): string | undefined {
  if (incoming.some((file) => !file.size || file.size > limits.maxBytes)) {
    return `Files cannot be empty and must stay under ${Math.round(limits.maxBytes / 1024 / 1024)} MB each`;
  }
  if (currentCount + incoming.length > limits.maxCount) {
    return `A message can carry at most ${limits.maxCount} files`;
  }
  return undefined;
}
