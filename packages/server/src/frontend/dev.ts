/**
 * Development frontend: Vite in middleware mode inside the server process.
 *
 * Development then has the same single origin as production: one port serves
 * the page, the API and Vite's HMR socket, so there is no proxy to keep in
 * step with the routes and no second port. Production serves the built client
 * through `static.ts` instead.
 */
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import type { ConfigEnv, UserConfigExport, ViteDevServer } from "vite";

type CreateServer = (options: object, listener: RequestListener) => Server;

const viteConfigFile = new URL("../../../../vite.config.ts", import.meta.url);

/** Paths the Hono app owns; everything else is the client, served by Vite. */
function isServerPath(url: string | undefined): boolean {
  const pathname = (url ?? "/").split("?")[0] ?? "/";
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/health";
}

export class DevFrontend {
  private vite?: ViteDevServer;
  private starting?: Promise<ViteDevServer>;

  /**
   * Wrap the server factory so the Hono listener only sees server paths.
   * Requests for the client wait for Vite if it is still starting.
   */
  wrap(create: CreateServer): CreateServer {
    return (options, hono) =>
      create(options, (request: IncomingMessage, response: ServerResponse) => {
        if (isServerPath(request.url)) return hono(request, response);
        const vite = this.vite ?? this.starting;
        if (!vite) return hono(request, response);
        void Promise.resolve(vite).then(
          (server) => server.middlewares(request, response, () => hono(request, response)),
          (error: unknown) => {
            response.statusCode = 500;
            response.end(`Vite failed to start: ${error instanceof Error ? error.message : error}`);
          },
        );
      });
  }

  /** Start Vite with its HMR socket on the server that serves the API. */
  async attach(server: Server): Promise<void> {
    this.starting = (async () => {
      const { createServer } = await import("vite");
      // Imported rather than given as `configFile`: Vite would bundle it to a
      // temporary file beside the config, which the tsx watcher would see come
      // and go and restart on. Importing it also restarts the server when the
      // config itself changes.
      const exported = ((await import(viteConfigFile.href)) as { default: UserConfigExport })
        .default;
      const env: ConfigEnv = {
        command: "serve",
        mode: "development",
        isSsrBuild: false,
        isPreview: false,
      };
      const config = await (typeof exported === "function" ? exported(env) : exported);
      return createServer({
        ...config,
        configFile: false,
        appType: "spa",
        server: { ...config.server, middlewareMode: true, hmr: { server } },
      });
    })();
    this.vite = await this.starting;
  }

  async close(): Promise<void> {
    await this.vite?.close();
  }
}
