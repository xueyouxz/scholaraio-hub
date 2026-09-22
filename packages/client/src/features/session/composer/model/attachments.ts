import { ATTACHMENT_LIMITS, type ProviderCapabilities } from "@scholaraio-hub/shared";

export type AttachmentLimits = ProviderCapabilities["attachments"];

/** Why these files cannot be added to a message that already has `currentCount`, if at all. */
export function rejectAttachments(
  currentCount: number,
  incoming: Pick<File, "size">[],
  limits: AttachmentLimits = ATTACHMENT_LIMITS,
): string | undefined {
  if (incoming.some((file) => !file.size || file.size > limits.maxBytes)) {
    return `附件不能为空，且单个文件不能超过 ${Math.round(limits.maxBytes / 1024 / 1024)} MB`;
  }
  if (currentCount + incoming.length > limits.maxCount) {
    return `每条消息最多添加 ${limits.maxCount} 个附件`;
  }
  return undefined;
}
