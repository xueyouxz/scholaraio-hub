import { Hono } from "hono";
import { createActivitySubscription, createSessionSubscription } from "../subscriptions.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { EventBus } from "../watcher/index.js";

export interface StreamsDeps {
  supervisor: Supervisor;
  eventBus?: EventBus;
}

function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createStreamsRoutes(deps: StreamsDeps): Hono {
  const routes = new Hono();

  // GET /api/sessions/:sessionId/stream - Stream a live session via SSE
  routes.get("/sessions/:sessionId/stream", (c) => {
    const sessionId = c.req.param("sessionId");
    const process = deps.supervisor.getProcessForSession(sessionId);

    if (!process) {
      return c.json({ error: "No active process for session" }, 404);
    }

    const encoder = new TextEncoder();
    const abortSignal = c.req.raw.signal;

    let closed = false;
    let cleanup = () => {};

    const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (closed) return;
      closed = true;
      cleanup();
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (eventType: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(formatSSE(eventType, data)));

          if (eventType === "complete") {
            close(controller);
          }
        };

        cleanup = createSessionSubscription(process, emit, {
          onError: (err) => {
            const message = err instanceof Error ? err.message : String(err);
            emit("error", { message });
          },
        }).cleanup;

        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            () => {
              close(controller);
            },
            { once: true },
          );
        }
      },
      cancel() {
        if (closed) return;
        closed = true;
        cleanup();
      },
    });

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return new Response(stream, {
      status: 200,
      headers: c.res.headers,
    });
  });

  // GET /api/activity/stream - Stream global activity changes via SSE
  routes.get("/activity/stream", (c) => {
    if (!deps.eventBus) {
      return c.json({ error: "Event bus not available" }, 503);
    }

    const encoder = new TextEncoder();
    const abortSignal = c.req.raw.signal;

    let closed = false;
    let cleanup = () => {};

    const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (closed) return;
      closed = true;
      cleanup();
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (eventType: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(formatSSE(eventType, data)));
        };

        cleanup = createActivitySubscription(deps.eventBus as EventBus, emit, {
          onError: (err) => {
            const message = err instanceof Error ? err.message : String(err);
            emit("error", { message });
          },
        }).cleanup;

        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            () => {
              close(controller);
            },
            { once: true },
          );
        }
      },
      cancel() {
        if (closed) return;
        closed = true;
        cleanup();
      },
    });

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return new Response(stream, {
      status: 200,
      headers: c.res.headers,
    });
  });

  return routes;
}
