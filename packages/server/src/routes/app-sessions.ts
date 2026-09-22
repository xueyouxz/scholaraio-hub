import { readFile } from "node:fs/promises";
import {
  CreateSessionSchema,
  SendSessionMessageSchema,
  SessionOptionsSchema,
} from "@scholaraio-hub/shared";
import { createUIMessageStreamResponse } from "ai";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import {
  SessionConflictError,
  SessionOptionsError,
  SessionScopeError,
  type SessionService,
} from "../services/SessionService.js";
import { AttachmentError, MAX_ATTACHMENT_BYTES } from "../sessions/SessionAttachments.js";
import { SessionFiles } from "../sessions/SessionFiles.js";
import { importHistory } from "../sessions/import-history.js";

export function createAppSessionRoutes(service: SessionService, settings?: ServerSettingsService) {
  const routes = new Hono();
  const files = new SessionFiles(service.store);
  routes.get("/", (c) => c.json({ sessions: service.store.list() }));
  routes.post("/", async (c) => {
    const raw = CreateSessionSchema.extend({
      provider: z.enum(["claude", "codex"]).optional(),
    }).parse(await c.req.json());
    const defaults = settings?.getSettings().newSessionDefaults;
    const provider = raw.provider ?? defaults?.provider ?? "claude";
    const input = CreateSessionSchema.parse({
      ...raw,
      provider,
      model:
        raw.model === ""
          ? undefined
          : (raw.model ?? (provider === defaults?.provider ? defaults.model : undefined)),
    });
    await service.validateScope(input);
    await service.validateExecution(input.provider, input);
    return c.json(service.store.public(await service.store.create(input)), 201);
  });
  routes.post("/import", async (c) => {
    const input = z
      .object({
        provider: z.enum(["claude", "codex"]),
        title: z.string().max(200),
        content: z.string().max(25_000_000),
      })
      .parse(await c.req.json());
    const messages = await importHistory(input.content, input.provider);
    const record = await service.store.create({
      title: input.title,
      provider: input.provider,
      paperIds: [],
    });
    record.messages = messages;
    record.readOnly = true;
    await service.store.save(record);
    return c.json(service.store.public(record), 201);
  });
  routes.post(
    "/:id/attachments",
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + 65536 }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new AttachmentError("请选择附件文件");
      return c.json(await service.attachments.upload(c.req.param("id"), file), 201);
    },
  );
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
    const bytes = await files.read(c.req.param("id"), relative, true);
    c.header("Content-Type", "application/octet-stream");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(relative.split("/").at(-1) ?? "file")}`,
    );
    return c.body(new Uint8Array(bytes));
  });
  routes.get("/commands", async (c) =>
    c.json({
      commands: await service.commands(
        undefined,
        z.enum(["claude", "codex"]).default("claude").parse(c.req.query("provider")),
      ),
    }),
  );
  routes.get("/:id/commands", async (c) =>
    c.json({ commands: await service.commands(c.req.param("id")) }),
  );
  routes.get("/:id", (c) => c.json(service.detail(c.req.param("id"))));
  routes.patch("/:id/options", async (c) => {
    const input = SessionOptionsSchema.strict().parse(await c.req.json());
    return c.json(await service.updateOptions(c.req.param("id"), input));
  });
  routes.post("/:id/messages", async (c) => {
    const input = SendSessionMessageSchema.parse(await c.req.json());
    await service.send(c.req.param("id"), input);
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    if (!stream) return c.json({ error: "本轮已结束，请刷新会话。" }, 409);
    return createUIMessageStreamResponse({ stream });
  });
  routes.post("/:id/queue", async (c) =>
    c.json(
      await service.enqueue(c.req.param("id"), SendSessionMessageSchema.parse(await c.req.json())),
    ),
  );
  routes.patch("/:id/queue", async (c) => {
    const input = z
      .object({ action: z.enum(["resume", "remove"]), messageId: z.string().optional() })
      .parse(await c.req.json());
    return c.json(await service.editQueue(c.req.param("id"), input.action, input.messageId));
  });
  routes.get("/:id/stream", (c) => {
    service.store.get(c.req.param("id"));
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    return stream ? createUIMessageStreamResponse({ stream }) : c.body(null, 204);
  });
  routes.post("/:id/stop", async (c) => {
    await service.stop(c.req.param("id"));
    return c.json({ stopped: true });
  });
  routes.post("/:id/input", async (c) => {
    const input = z
      .object({
        requestId: z.string(),
        decision: z.enum(["approve", "approve_accept_edits", "deny"]),
        answers: z.record(z.string(), z.string()).optional(),
      })
      .parse(await c.req.json());
    const accepted = service.input(
      c.req.param("id"),
      input.requestId,
      input.decision,
      input.answers,
    );
    return c.json({ accepted }, accepted ? 200 : 409);
  });
  routes.onError((error, c) => {
    console.error("[Sessions] request failed", error);
    return c.json(
      { error: error.message },
      error.message === "Session not found"
        ? 404
        : error instanceof z.ZodError ||
            error instanceof SyntaxError ||
            error instanceof SessionScopeError ||
            error instanceof SessionOptionsError ||
            error instanceof AttachmentError
          ? 400
          : error instanceof SessionConflictError
            ? 409
            : 500,
    );
  });
  return routes;
}
