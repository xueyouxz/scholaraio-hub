import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../http.js";
import { loggerFor } from "../logging/logger.js";
import type { HubEvents } from "../services/HubEvents.js";

/** How often an idle stream is told the server is still there, so proxies keep it open. */
const HEARTBEAT_MS = 30_000;

/** 变更推送：列表页订阅后按事件重新请求，不再轮询。 */
export function createEventRoutes({ events }: { events: HubEvents }) {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const send = (message: { data: string; event?: string }) =>
        stream.writeSSE(message).catch((error) => {
          loggerFor("events").debug({ err: error }, "Event stream write failed");
        });
      // Changes are plain messages, as the library service sends its own.
      const unsubscribe = events.subscribe((event) => void send({ data: JSON.stringify(event) }));
      const heartbeat = setInterval(() => void send({ event: "ping", data: "" }), HEARTBEAT_MS);
      // Held open until the page goes away or the server closes.
      await new Promise<void>((resolve) => {
        if (events.closed.aborted) resolve();
        events.closed.addEventListener("abort", () => resolve(), { once: true });
        stream.onAbort(resolve);
      });
      clearInterval(heartbeat);
      unsubscribe();
    }),
  );
  return routes;
}
