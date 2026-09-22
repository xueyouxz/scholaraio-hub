export interface AttachmentLimits {
  maxBytes: number;
  maxCount: number;
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxCount: 10,
};

/** Why these files cannot be added to a message that already has `currentCount`, if at all. */
export function rejectAttachments(
  currentCount: number,
  incoming: Pick<File, "size">[],
  limits: AttachmentLimits = DEFAULT_ATTACHMENT_LIMITS,
): string | undefined {
  if (incoming.some((file) => !file.size || file.size > limits.maxBytes)) {
    return `附件不能为空，且单个文件不能超过 ${Math.round(limits.maxBytes / 1024 / 1024)} MB`;
  }
  if (currentCount + incoming.length > limits.maxCount) {
    return `每条消息最多添加 ${limits.maxCount} 个附件`;
  }
  return undefined;
}
