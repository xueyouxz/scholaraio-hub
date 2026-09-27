import {
  type ApiErrorDetails,
  CSRF_HEADER,
  LIBRARY_PORT_META,
  parseApiResponse,
} from "@scholaraio-hub/shared";

/** 保存 HTTP 状态、业务错误码、请求标识和字段详情。 */
export class HttpError extends Error {
  method?: string;
  constructor(
    message: string,
    readonly status: number,
    readonly code = "HTTP_ERROR",
    readonly requestId?: string,
    readonly details: ApiErrorDetails | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 解析 JSON 响应外壳，返回业务数据或抛出结构化错误。 */
export function decodeResponse<T>(payload: unknown, status: number, requestId?: string): T {
  let parsed: ReturnType<typeof parseApiResponse>;
  try {
    parsed = parseApiResponse(payload);
  } catch {
    throw new HttpError("Invalid API response format", status, "INVALID_RESPONSE", requestId);
  }
  if (parsed.code !== "success")
    throw new HttpError(parsed.message, status, parsed.code, parsed.id, parsed.data);
  if (status < 200 || status >= 300)
    throw new HttpError("Invalid API response status", status, "INVALID_RESPONSE", parsed.id);
  return parsed.data as T;
}

/** 读取 HTTP 响应并处理空响应、非 JSON 内容和业务错误。 */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const id = response.headers.get("X-Request-ID") ?? undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError("API response is not valid JSON", response.status, "INVALID_RESPONSE", id);
  }
  return decodeResponse<T>(payload, response.status, id);
}

/** 构造包含应用访问标识的请求头。 */
export function hubHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set(CSRF_HEADER.name, CSRF_HEADER.value);
  return headers;
}

/** 根据页面配置生成文献服务地址。 */
export function libraryUrl(path: string): string {
  const port = document
    .querySelector<HTMLMetaElement>(`meta[name="${LIBRARY_PORT_META}"]`)
    ?.getAttribute("content");
  if (!port) throw new Error("The page is missing the library service port. Refresh the page.");
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`;
}

/** 编码 URL 中的单个路径参数。 */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

export type HttpRequestOptions = Omit<RequestInit, "body"> & {
  timeoutMs?: number;
} & ({ json: unknown; body?: never } | { json?: never; body?: BodyInit | null });

interface HttpClientOptions {
  baseUrl: string | (() => string);
  fetchImpl?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit);
  timeoutMs?: number;
}

/** 创建可配置的 HTTP 客户端，管理请求头、取消、超时和响应读取。 */
export function createHttpClient(config: HttpClientOptions) {
  /** 构造当前服务中的资源地址。 */
  function url(path: string): string {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Resource path must start with a single slash");
    const base = typeof config.baseUrl === "function" ? config.baseUrl() : config.baseUrl;
    return `${base.replace(/\/$/, "")}${path}`;
  }

  /** 在请求有效期内消费响应，并释放计时器和取消监听。 */
  async function read<T>(
    path: string,
    options: HttpRequestOptions,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const { timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS, signal, json, ...init } = options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("Request timeout must be a positive finite number");
    signal?.throwIfAborted();
    const method = (init.method ?? "GET").toUpperCase();
    const address = url(path);
    const headers = new Headers(
      typeof config.headers === "function" ? config.headers() : config.headers,
    );
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (json !== undefined) headers.set("Content-Type", "application/json");
    const body = json === undefined ? init.body : JSON.stringify(json);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
      timeoutMs,
    );
    try {
      const response = await (config.fetchImpl ?? fetch)(address, {
        ...init,
        method,
        headers,
        body,
        signal: controller.signal,
      });
      return await consume(response);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const failure = controller.signal.aborted
        ? new HttpError("Request timed out", 0, "REQUEST_TIMEOUT")
        : error instanceof TypeError
          ? new HttpError("Network connection failed", 0, "NETWORK_ERROR")
          : error;
      if (failure instanceof HttpError) failure.method = method;
      throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  return {
    url,
    read,
    /** 请求 JSON 接口并返回解包后的业务数据。 */
    json<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
      return read(path, options, readJsonResponse<T>);
    },
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
export const hubHttp = createHttpClient({ baseUrl: "/api", headers: hubHeaders });
export const libraryHttp = createHttpClient({ baseUrl: () => libraryUrl(""), headers: hubHeaders });

/** 判断查询失败是否允许进行有限重试。 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (
    failureCount >= 2 ||
    !(error instanceof HttpError) ||
    error.method !== "GET" ||
    error.code === "INVALID_RESPONSE"
  )
    return false;
  return (
    error.code === "NETWORK_ERROR" ||
    error.code === "REQUEST_TIMEOUT" ||
    [502, 503, 504].includes(error.status)
  );
}
