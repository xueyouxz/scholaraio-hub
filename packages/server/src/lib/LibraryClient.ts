import { CSRF_HEADER } from "@scholaraio-hub/shared";

/** How long a request to the library may take unless the caller gives its own signal. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How long the status probe waits for the library's health check. */
const PROBE_TIMEOUT_MS = 2000;

/** The library answered a request with an error status; `detail` is its message. */
export class LibraryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`文献请求失败 (${status}): ${detail}`);
  }
}

/** The library service did not answer: it is not running, not reachable, or too slow. */
export class LibraryUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    super(
      timedOut
        ? `文献服务（${baseUrl}）响应超时。`
        : `文献服务不可用（${baseUrl}），请确认它已随 Hub 启动并查看其日志。`,
      { cause },
    );
  }
}

/**
 * The server's client of the library service, which the launcher runs beside
 * it at `LIBRARY_URL`. The server neither starts nor stops that service; it
 * only calls its API, as the browser and the agents' CLI do.
 */
export class LibraryClient {
  constructor(readonly baseUrl: string) {}

  async request(resource: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(CSRF_HEADER.name, CSRF_HEADER.value);
    try {
      return await fetch(`${this.baseUrl}${resource}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A caller that gave up is not the library's failure.
      if (init.signal?.aborted) throw error;
      throw new LibraryUnavailableError(this.baseUrl, error);
    }
  }

  async json<T>(resource: string, init?: RequestInit): Promise<T> {
    const response = await this.request(resource, init);
    if (!response.ok) throw new LibraryRequestError(response.status, await errorText(response));
    return response.json() as Promise<T>;
  }

  /** Whether the library answers its health check right now. */
  async available(): Promise<boolean> {
    try {
      const response = await this.request("/health", {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      // Unreachable or too slow: that is the answer, not an error.
      return false;
    }
  }
}

/** The service's `{"error": ...}` message, or its whole body when it has none. */
async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: the text itself is the message.
  }
  return text;
}
