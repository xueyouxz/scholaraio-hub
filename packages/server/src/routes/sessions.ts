import { readFile } from "node:fs/promises";
import {
  CreateSessionSchema,
  PROVIDER_NAMES,
  SendSessionMessageSchema,
  SessionOptionsSchema,
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
import { MAX_ATTACHMENT_BYTES } from "../sessions/SessionAttachments.js";
import { SessionFiles } from "../sessions/SessionFiles.js";
import type { SessionService } from "../sessions/SessionService.js";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const RENAME_SCHEMA = z.object({ title: z.string().trim().min(1).max(200) }).strict();
const FORK_SCHEMA = z.object({ messageId: z.string().min(1).optional() });
const REWIND_SCHEMA = z.object({ messageId: z.string().min(1) });
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

/** 创建会话领域接口，提供记录、执行、交互、历史和文件操作。 */
export function createSessionRoutes(service: SessionService, settings?: ServerSettingsService) {
  const routes = new Hono<AppEnv>();
  const files = new SessionFiles((id) => service.workingDirectory(id));

  // 命令发现：全局命令与会话命令。
  routes.get(
    "/commands",
    validate("query", z.object({ provider: z.enum(PROVIDER_NAMES).optional() })),
    async (c) =>
      success(c, { commands: await service.commands(undefined, c.req.valid("query").provider) }),
  );
  routes.get("/:id/commands", async (c) =>
    success(c, { commands: await service.commands(c.req.param("id")) }),
  );

  // 会话记录：列表、创建、详情、重命名、删除和选项。
  routes.get("/", (c) => success(c, { sessions: service.store.list() }));
  routes.post("/", validate("json", CreateSessionSchema.partial({ provider: true })), async (c) => {
    const defaults = settings?.getSettings().newSessionDefaults;
    const session = await service.create(c.req.valid("json"), defaults);
    return created(c, session, `/api/sessions/${session.id}`);
  });
  routes.get("/:id", (c) => success(c, service.detail(c.req.param("id"))));
  routes.patch("/:id", validate("json", RENAME_SCHEMA), async (c) =>
    success(c, await service.rename(c.req.param("id"), c.req.valid("json").title)),
  );
  routes.delete("/:id", async (c) => {
    await service.delete(c.req.param("id"));
    return emptyBody(c);
  });
  routes.patch("/:id/options", validate("json", SessionOptionsSchema.strict()), async (c) =>
    success(c, await service.updateOptions(c.req.param("id"), c.req.valid("json"))),
  );

  // 会话执行：发送消息、订阅响应和停止。
  routes.post("/:id/messages", validate("json", SendSessionMessageSchema), async (c) => {
    await service.send(c.req.param("id"), c.req.valid("json"));
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    if (!stream) throw new ApiError("STATE_CONFLICT", "This turn has ended. Refresh the session.");
    return createUIMessageStreamResponse({ stream });
  });
  routes.get("/:id/stream", (c) => {
    service.store.get(c.req.param("id"));
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

  // 历史操作：分叉与回退。
  routes.post("/:id/fork", async (c) => {
    const { messageId } = await optionalJson(c.req, FORK_SCHEMA);
    const session = await service.fork(c.req.param("id"), messageId);
    return created(c, session, `/api/sessions/${session.id}`);
  });
  routes.post("/:id/rewind", validate("json", REWIND_SCHEMA), async (c) =>
    success(c, await service.rewind(c.req.param("id"), c.req.valid("json").messageId)),
  );

  // 附件与文件：草稿上传、附件管理、工作目录浏览和下载。
  routes.post(
    "/draft-attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES }),
    async (c) => {
      const file = await readUploadedFile(c.req);
      return created(c, await service.attachments.uploadDraft(file));
    },
  );
  routes.delete("/draft-attachments/:attachmentId", async (c) => {
    await service.attachments.removeDraft(c.req.param("attachmentId"));
    return emptyBody(c);
  });
  routes.post(
    "/:id/attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES }),
    async (c) => {
      const file = await readUploadedFile(c.req);
      return created(c, await service.attachments.upload(c.req.param("id"), file));
    },
  );
  routes.delete("/:id/attachments/:attachmentId", async (c) => {
    await service.attachments.remove(c.req.param("id"), c.req.param("attachmentId"));
    return emptyBody(c);
  });
  routes.get("/:id/attachments/:attachmentId", async (c) => {
    const { visible, file } = await service.attachments.resolve(
      c.req.param("id"),
      c.req.param("attachmentId"),
    );
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
