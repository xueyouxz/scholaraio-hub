import {
  type ApiErrorCode,
  type ApiErrorDetails,
  CSRF_HEADER,
  type LibraryContext,
  type LiteratureCollection,
  parseApiResponse,
} from "@scholaraio-hub/shared";

/** How long a request to the library may take unless the caller gives its own signal. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How long the status probe waits for the library's health check. */
const PROBE_TIMEOUT_MS = 2000;

/** The library answered a request with an error status; `detail` is its message. */
export class LibraryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code: ApiErrorCode = "UPSTREAM_ERROR",
    readonly details: ApiErrorDetails | null = null,
  ) {
    super(`Library request failed (${status}): ${detail}`);
  }
}

/** The library service did not answer: it is not running, not reachable, or too slow. */
export class LibraryUnavailableError extends Error {
  readonly timedOut: boolean;
  constructor(baseUrl: string, cause: unknown) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    super(
      timedOut
        ? `Library service timed out (${baseUrl}).`
        : `Library service unavailable (${baseUrl}). Check that it is running and inspect its logs.`,
      { cause },
    );
    this.timedOut = timedOut;
  }
}

/** The papers a session reads from: whole literature collections, and single papers. */
export interface LibraryScope {
  collectionIds: string[];
  paperIds: string[];
}

/** 调用独立文献服务并解析其统一响应。 */
export class LibraryClient {
  constructor(readonly baseUrl: string) {}

  /** 获取文献服务端口。 */
  get port(): number {
    const url = new URL(this.baseUrl);
    return Number(url.port || (url.protocol === "https:" ? 443 : 80));
  }

  /** 发送文献服务请求，附加访问标识并处理连接错误。 */
  protected async request(resource: string, init: RequestInit = {}): Promise<Response> {
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

  /** 调用文献 JSON 接口并解包业务数据或抛出业务错误。 */
  private async json<T>(resource: string, init?: RequestInit): Promise<T> {
    const response = await this.request(resource, init);
    let payload: ReturnType<typeof parseApiResponse>;
    try {
      payload = parseApiResponse(await response.json());
    } catch {
      throw new LibraryRequestError(
        502,
        "Invalid library service response format.",
        "UPSTREAM_ERROR",
      );
    }
    if (payload.code !== "success")
      throw new LibraryRequestError(response.status, payload.message, payload.code, payload.data);
    if (!response.ok)
      throw new LibraryRequestError(502, "Invalid library service response status.");
    return payload.data as T;
  }

  /** 确认文献库有这些论文与文献集合；没有时抛出 4xx 的 `LibraryRequestError`。 */
  async checkScope(scope: LibraryScope): Promise<void> {
    await this.post("/scope", scope);
  }

  /** 从范围内的论文中检索与 `query` 相关的段落。 */
  context(scope: LibraryScope & { query: string }): Promise<LibraryContext> {
    return this.post<LibraryContext>("/context", scope);
  }

  /** 全部文献集合；会话按 id 引用它们，agent 按名称使用它们。 */
  async collections(): Promise<LiteratureCollection[]> {
    return (await this.json<{ collections: LiteratureCollection[] }>("/collections")).collections;
  }

  /** 检查文献服务当前是否可用。 */
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

  private post<T>(resource: string, body: unknown): Promise<T> {
    return this.json<T>(resource, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
