/** 表示指定会话不存在。 */
export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session not found: ${id}`);
  }
}

/** 表示文件、路径、作用域或选项不符合会话要求。 */
export class SessionInputError extends Error {}

/** 表示当前会话状态与操作要求冲突。 */
export class SessionConflictError extends Error {
  /** 保存会话状态冲突的提示和业务错误码。 */
  constructor(
    message: string,
    readonly code: "STATE_CONFLICT" | "SESSION_BUSY" = "STATE_CONFLICT",
  ) {
    super(message);
  }
}

/** 表示会话引用的文件或Attachment not found。 */
export class SessionResourceNotFoundError extends Error {}

/** 表示附件或文件超过会话的大小限制。 */
export class SessionFileTooLargeError extends Error {}
