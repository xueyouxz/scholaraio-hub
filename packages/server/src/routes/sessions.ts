import { readFile } from "node:fs/promises";
import {
  CreateSessionSchema,
  DEFAULT_PROVIDER,
  PROVIDER_NAMES,
  SendSessionMessageSchema,
  SessionOptionsSchema,
} from "@scholaraio-hub/shared";
import { createUIMessageStreamResponse } from "ai";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { MAX_ATTACHMENT_BYTES } from "../sessions/SessionAttachments.js";
import { SessionFiles } from "../sessions/SessionFiles.js";
import type { SessionService } from "../sessions/SessionService.js";
import { SessionInputError } from "../sessions/errors.js";
import { validate } from "./validate.js";

export function createSessionRoutes(service: SessionService, settings?: ServerSettingsService) {
  const routes = new Hono();
  const files = new SessionFiles((id) => service.workingDirectory(id));
  routes.get("/", (c) => c.json({ sessions: service.store.list() }));
  routes.post("/", validate("json", CreateSessionSchema.partial({ provider: true })), async (c) => {
    const defaults = settings?.getSettings().newSessionDefaults;
    return c.json(await service.create(c.req.valid("json"), defaults), 201);
  });
  // A new chat's files upload before its session exists; creating it claims them.
  routes.post(
    "/draft-attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + 65536 }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new SessionInputError("请选择附件文件");
      return c.json(await service.attachments.uploadDraft(file), 201);
    },
  );
  routes.delete("/draft-attachments/:attachmentId", async (c) => {
    await service.attachments.removeDraft(c.req.param("attachmentId"));
    return c.body(null, 204);
  });
  routes.post(
    "/:id/attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + 65536 }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new SessionInputError("请选择附件文件");
      return c.json(await service.attachments.upload(c.req.param("id"), file), 201);
    },
  );
  routes.delete("/:id/attachments/:attachmentId", async (c) => {
    await service.attachments.remove(c.req.param("id"), c.req.param("attachmentId"));
    return c.body(null, 204);
  });
  routes.get("/:id/attachments/:attachmentId", async (c) => {
    const { visible, file } = await service.attachments.resolve(
      c.req.param("id"),
      c.req.param("attachmentId"),
    );
    c.header("Content-Type", visible.mediaType);
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(visible.filename)}`,
    );
    return c.body(await readFile(file.path));
  });
  routes.get("/:id/fs/browse", async (c) =>
    c.json(await files.browse(c.req.param("id"), c.req.query("path") ?? "")),
  );
  routes.get("/:id/fs/file", async (c) =>
    c.json(await files.preview(c.req.param("id"), c.req.query("path") ?? "")),
  );
  routes.get("/:id/fs/raw", async (c) => {
    const relative = c.req.query("path") ?? "";
    const { bytes } = await files.read(c.req.param("id"), relative, true);
    c.header("Content-Type", "application/octet-stream");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(relative.split("/").at(-1) ?? "file")}`,
    );
    return c.body(new Uint8Array(bytes));
  });
  routes.get(
    "/commands",
    validate("query", z.object({ provider: z.enum(PROVIDER_NAMES).default(DEFAULT_PROVIDER) })),
    async (c) =>
      c.json({ commands: await service.commands(undefined, c.req.valid("query").provider) }),
  );
  routes.get("/:id/commands", async (c) =>
    c.json({ commands: await service.commands(c.req.param("id")) }),
  );
  routes.get("/:id", (c) => c.json(service.detail(c.req.param("id"))));
  routes.patch(
    "/:id",
    validate("json", z.object({ title: z.string().trim().min(1).max(200) }).strict()),
    async (c) => c.json(await service.rename(c.req.param("id"), c.req.valid("json").title)),
  );
  routes.delete("/:id", async (c) => {
    await service.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  routes.patch("/:id/options", validate("json", SessionOptionsSchema.strict()), async (c) =>
    c.json(await service.updateOptions(c.req.param("id"), c.req.valid("json"))),
  );
  routes.post("/:id/messages", validate("json", SendSessionMessageSchema), async (c) => {
    await service.send(c.req.param("id"), c.req.valid("json"));
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    if (!stream) return c.json({ error: "本轮已结束，请刷新会话。" }, 409);
    return createUIMessageStreamResponse({ stream });
  });
  routes.post("/:id/queue", validate("json", SendSessionMessageSchema), async (c) =>
    c.json(await service.enqueue(c.req.param("id"), c.req.valid("json"))),
  );
  routes.patch(
    "/:id/queue",
    validate(
      "json",
      z.object({ action: z.enum(["resume", "remove"]), messageId: z.string().optional() }),
    ),
    async (c) => {
      const { action, messageId } = c.req.valid("json");
      return c.json(await service.editQueue(c.req.param("id"), action, messageId));
    },
  );
  // The body is optional (the validator refuses an empty one): without a
  // messageId the fork holds the whole session.
  routes.post("/:id/fork", async (c) => {
    const { messageId } = z
      .object({ messageId: z.string().min(1).optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await service.fork(c.req.param("id"), messageId), 201);
  });
  routes.post(
    "/:id/rewind",
    validate("json", z.object({ messageId: z.string().min(1) })),
    async (c) => c.json(await service.rewind(c.req.param("id"), c.req.valid("json").messageId)),
  );
  routes.get("/:id/stream", (c) => {
    service.store.get(c.req.param("id"));
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    return stream ? createUIMessageStreamResponse({ stream }) : c.body(null, 204);
  });
  routes.post("/:id/stop", async (c) => {
    await service.stop(c.req.param("id"));
    return c.json({ stopped: true });
  });
  routes.post(
    "/:id/input",
    validate(
      "json",
      z.object({
        requestId: z.string(),
        decision: z.enum(["approve", "approve_accept_edits", "deny"]),
        answers: z.record(z.string(), z.string()).optional(),
      }),
    ),
    (c) => {
      const input = c.req.valid("json");
      const accepted = service.input(
        c.req.param("id"),
        input.requestId,
        input.decision,
        input.answers,
      );
      return c.json({ accepted }, accepted ? 200 : 409);
    },
  );
  return routes;
}
