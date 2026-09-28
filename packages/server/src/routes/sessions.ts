import { readFile } from "node:fs/promises";
import {
  ChatMessageSchema,
  CreateSessionSchema,
  PROVIDER_NAMES,
  SendSessionMessageSchema,
  SessionOptionsSchema,
  SessionReferencesSchema,
  SessionUpdateSchema,
} from "@scholaraio-hub/shared";
import { createUIMessageStreamResponse } from "ai";
import { Hono, type HonoRequest } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  ApiError,
  type AppEnv,
  created,
  emptyBody,
  optionalJson,
  success,
  validate,
} from "../http.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { MAX_ATTACHMENT_BYTES, type SessionAttachments } from "../sessions/SessionAttachments.js";
import type { SessionFiles } from "../sessions/SessionFiles.js";
import type { SessionService } from "../sessions/SessionService.js";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const FORK_SCHEMA = z.object({ messageId: z.string().min(1).optional() });
const QUEUE_SCHEMA = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("remove"), messageId: z.string().min(1) }),
]);
const INPUT_SCHEMA = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approve", "approve_accept_edits", "deny"]),
  answers: z.record(z.string(), z.string()).optional(),
});

/** 解析上传表单并返回文件字段。 */
async function readUploadedFile(request: HonoRequest): Promise<File> {
  if (!request.header("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Upload request must use multipart form data.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ApiError("INVALID_MULTIPART", "Invalid multipart form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File))
    throw new ApiError("VALIDATION_FAILED", "Select an attachment file.");
  return file;
}

/** 生成附件下载响应使用的文件名头。 */
function downloadDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface SessionRoutesDeps {
  sessions: SessionService;
  attachments: SessionAttachments;
  files: SessionFiles;
  /** 新建会话时的默认 Provider 与模型。 */
  settings?: ServerSettingsService;
}

/**
 * 创建会话领域接口，提供执行、交互、历史和文件操作。会话 id 是 `sessionKey`：
 * Provider 名加它自己的会话 id（如 `claude:<id>`）。会话列表按项目提供（`/api/projects`）。
 */
export function createSessionRoutes({
  sessions: service,
  attachments,
  files,
  settings,
}: SessionRoutesDeps) {
  const routes = new Hono<AppEnv>();

  // 命令发现：新会话（按 Provider 与目录）与已有会话的命令。
  routes.get(
    "/commands",
    validate(
      "query",
      z.object({
        provider: z.enum(PROVIDER_NAMES).optional(),
        cwd: z.string().min(1).max(4096).optional(),
      }),
    ),
    async (c) => {
      const { provider, cwd } = c.req.valid("query");
      return success(c, { commands: await service.commands(undefined, provider, cwd) });
    },
  );
  routes.get("/:id/commands", async (c) =>
    success(c, { commands: await service.commands(c.req.param("id")) }),
  );

  // 会话：以首条消息创建、详情、重命名与归档、引用的文献和执行选项。
  routes.post("/", validate("json", CreateSessionSchema.partial({ provider: true })), async (c) => {
    const defaults = settings?.getSettings().newSessionDefaults;
    const session = await service.create(c.req.valid("json"), defaults);
    return created(c, session, `/api/sessions/${encodeURIComponent(session.id)}`);
  });
  routes.get("/:id", async (c) => success(c, await service.detail(c.req.param("id"))));
  routes.patch("/:id", validate("json", SessionUpdateSchema), async (c) =>
    success(c, await service.update(c.req.param("id"), c.req.valid("json"))),
  );
  routes.put("/:id/references", validate("json", SessionReferencesSchema), async (c) =>
    success(c, await service.setReferences(c.req.param("id"), c.req.valid("json").references)),
  );
  routes.patch("/:id/options", validate("json", SessionOptionsSchema.strict()), async (c) =>
    success(c, await service.updateOptions(c.req.param("id"), c.req.valid("json"))),
  );

  // 会话执行：发送消息、订阅响应和停止。
  routes.post("/:id/messages", validate("json", ChatMessageSchema), async (c) => {
    const { replaces, ...input } = c.req.valid("json");
    await service.send(c.req.param("id"), input, { replaces });
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    if (!stream) throw new ApiError("STATE_CONFLICT", "This turn has ended. Refresh the session.");
    return createUIMessageStreamResponse({ stream });
  });
  routes.get("/:id/stream", (c) => {
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    return stream ? createUIMessageStreamResponse({ stream }) : emptyBody(c);
  });
  routes.post("/:id/stop", async (c) => {
    await service.stop(c.req.param("id"));
    return success(c, { stopped: true });
  });

  // 队列与交互：消息排队、恢复、审批与问题回答。
  routes.post("/:id/queue", validate("json", SendSessionMessageSchema), async (c) =>
    success(c, await service.enqueue(c.req.param("id"), c.req.valid("json"))),
  );
  routes.patch("/:id/queue", validate("json", QUEUE_SCHEMA), async (c) => {
    const input = c.req.valid("json");
    return success(
      c,
      await service.editQueue(
        c.req.param("id"),
        input.action,
        input.action === "remove" ? input.messageId : undefined,
      ),
    );
  });
  routes.post("/:id/input", validate("json", INPUT_SCHEMA), (c) => {
    const input = c.req.valid("json");
    const accepted = service.input(
      c.req.param("id"),
      input.requestId,
      input.decision,
      input.answers,
    );
    if (!accepted)
      throw new ApiError(
        "APPROVAL_EXPIRED",
        "Approval request has already been handled or has expired.",
      );
    return success(c, { accepted });
  });

  // 历史操作：分叉。
  routes.post("/:id/fork", async (c) => {
    const { messageId } = await optionalJson(c.req, FORK_SCHEMA);
    const session = await service.fork(c.req.param("id"), messageId);
    return created(c, session, `/api/sessions/${encodeURIComponent(session.id)}`);
  });

  // 附件与文件：草稿上传、附件管理、工作目录浏览和下载。
  routes.post(
    "/draft-attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES }),
    async (c) => {
      const file = await readUploadedFile(c.req);
      return created(c, await attachments.uploadDraft(file));
    },
  );
  routes.delete("/draft-attachments/:attachmentId", async (c) => {
    await attachments.removeDraft(c.req.param("attachmentId"));
    return emptyBody(c);
  });
  routes.post(
    "/:id/attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES }),
    async (c) => {
      const file = await readUploadedFile(c.req);
      const owner = await service.attachmentsOf(c.req.param("id"));
      return created(c, await attachments.upload(owner, file));
    },
  );
  routes.delete("/:id/attachments/:attachmentId", async (c) => {
    const owner = await service.attachmentsOf(c.req.param("id"));
    await attachments.remove(owner, c.req.param("attachmentId"));
    return emptyBody(c);
  });
  routes.get("/:id/attachments/:attachmentId", async (c) => {
    const owner = await service.attachmentsOf(c.req.param("id"));
    const { visible, file } = await attachments.resolve(owner, c.req.param("attachmentId"));
    c.header("Content-Type", visible.mediaType);
    c.header("Content-Disposition", downloadDisposition(visible.filename));
    return c.body(await readFile(file.path));
  });
  routes.get("/:id/fs/browse", async (c) =>
    success(c, await files.browse(c.req.param("id"), c.req.query("path") ?? "")),
  );
  routes.get("/:id/fs/file", async (c) =>
    success(c, await files.preview(c.req.param("id"), c.req.query("path") ?? "")),
  );
  routes.get("/:id/fs/raw", async (c) => {
    const relative = c.req.query("path") ?? "";
    const { bytes } = await files.read(c.req.param("id"), relative, true);
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", downloadDisposition(relative.split("/").at(-1) ?? "file"));
    return c.body(new Uint8Array(bytes));
  });
  return routes;
}
