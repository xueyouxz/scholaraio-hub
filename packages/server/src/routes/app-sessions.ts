import { CreateSessionSchema, SendSessionMessageSchema } from "@scholaraio-hub/shared";
import { createUIMessageStreamResponse } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { SessionConflictError, type SessionService } from "../services/SessionService.js";
import { importHistory } from "../sessions/import-history.js";

export function createAppSessionRoutes(service: SessionService) {
  const routes = new Hono();
  routes.get("/", (c) => c.json({ sessions: service.store.list() }));
  routes.post("/", async (c) => {
    const input = CreateSessionSchema.parse(await c.req.json());
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
  routes.get("/:id", (c) => c.json(service.detail(c.req.param("id"))));
  routes.post("/:id/messages", async (c) => {
    const input = SendSessionMessageSchema.parse(await c.req.json());
    await service.send(c.req.param("id"), input);
    const stream = service.stream(c.req.param("id"), c.req.raw.signal);
    if (!stream) return c.json({ error: "本轮已结束，请刷新会话。" }, 409);
    return createUIMessageStreamResponse({ stream });
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
        decision: z.enum(["approve", "deny"]),
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
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof SessionConflictError
            ? 409
            : 500,
    );
  });
  return routes;
}
