import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  createHttpClient,
  decodeResponse,
  hubHttp,
  readJsonResponse,
  shouldRetryQuery,
} from "../http";

describe("统一 HTTP 客户端", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("解包业务数据并保留字段错误详情", () => {
    expect(
      decodeResponse(
        { id: "r1", code: "success", message: "success", data: { id: "session-1" } },
        201,
      ),
    ).toEqual({ id: "session-1" });
    try {
      decodeResponse(
        {
          id: "r2",
          code: "VALIDATION_FAILED",
          message: "Invalid parameters",
          data: { issues: [] },
        },
        422,
      );
      throw new Error("Expected an API error");
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: "r2",
        details: { issues: [] },
      });
    }
  });
  it("区分空响应与损坏的响应协议", async () => {
    await expect(readJsonResponse(new Response(null, { status: 204 }))).resolves.toBeUndefined();
    await expect(
      readJsonResponse(new Response("broken", { status: 502, headers: { "X-Request-ID": "r3" } })),
    ).rejects.toMatchObject({ status: 502, code: "INVALID_RESPONSE", requestId: "r3" });
    expect(() =>
      decodeResponse({ id: "r4", code: "success", message: "success", data: null }, 500),
    ).toThrow("Invalid API response status");
  });
  it("转交取消信号，不替表单设置 Content-Type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: "r5", code: "success", message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const form = new FormData();
    form.set("file", new File(["a"], "a.txt"));
    await hubHttp.json("/sessions/draft-attachments", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
    expect(options.body).toBe(form);
    expect(options.headers.has("Content-Type")).toBe(false);
    expect(options.headers.get("ScholarAIO-Hub")).toBe("true");
  });

  it("绑定服务地址与默认请求头，并序列化 JSON 请求", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ id: "r6", code: "success", message: "success", data: { name: "Project" } }),
      );
    const client = createHttpClient({
      baseUrl: () => "https://library.example/",
      headers: { "X-Client": "hub" },
      fetchImpl: fetchMock,
    });
    await expect(
      client.json("/projects", { method: "POST", json: { name: "Project" } }),
    ).resolves.toEqual({ name: "Project" });
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://library.example/projects");
    expect(options?.body).toBe('{"name":"Project"}');
    const headers = new Headers(options?.headers);
    expect(headers.get("X-Client")).toBe("hub");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(() => client.url("//other.example")).toThrow("Resource path");
  });

  it("已取消的请求不访问网络", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createHttpClient({ baseUrl: "/api", fetchImpl: fetchMock });
    const controller = new AbortController();
    controller.abort();
    await expect(client.json("/sessions", { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["headers", "body"])("在等待 %s 时执行超时并清理请求资源", async (stage) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetchMock = abortableFetch(stage);
    const client = createHttpClient({ baseUrl: "/api", fetchImpl: fetchMock, timeoutMs: 50 });
    const pending = client.json("/sessions", { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      method: "GET",
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["headers", "body"])("在等待 %s 时保留调用方的取消原因", async (stage) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const client = createHttpClient({ baseUrl: "/api", fetchImpl: abortableFetch(stage) });
    const pending = client.json("/sessions", { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 422])("HTTP %s 结束后释放计时器和取消监听", async (status) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const client = createHttpClient({
      baseUrl: "/api",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            id: "r7",
            code: status === 200 ? "success" : "VALIDATION_FAILED",
            message: "result",
            data: null,
          },
          { status },
        ),
      ),
    });
    const pending = client.json("/sessions", { signal: controller.signal });
    if (status === 200) await expect(pending).resolves.toBeNull();
    else await expect(pending).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("整库上传可等待超过普通上传时限，同时保留主动取消和资源释放", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetchMock = abortableFetch("headers");
    const client = createHttpClient({ baseUrl: "/api", fetchImpl: fetchMock });
    const pending = client.json("/documents/import", {
      method: "POST",
      timeoutMs: null,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await assertion;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("写操作网络失败不自动重发", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createHttpClient({ baseUrl: "/api", fetchImpl: fetchMock });
    await expect(client.json("/sessions", { method: "POST", json: {} })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      method: "POST",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("只允许 GET 的短暂失败重试两次", () => {
    const failure = new HttpError("Unavailable", 503, "UPSTREAM_UNAVAILABLE");
    failure.method = "GET";
    expect(shouldRetryQuery(0, failure)).toBe(true);
    expect(shouldRetryQuery(1, failure)).toBe(true);
    expect(shouldRetryQuery(2, failure)).toBe(false);
    failure.method = "POST";
    expect(shouldRetryQuery(0, failure)).toBe(false);
    for (const [status, code] of [
      [0, "NETWORK_ERROR"],
      [0, "REQUEST_TIMEOUT"],
      [503, "INVALID_RESPONSE"],
      [422, "VALIDATION_FAILED"],
      [409, "CONFLICT"],
      [429, "RATE_LIMITED"],
    ] as const) {
      const error = new HttpError("Failed", status, code);
      error.method = "GET";
      expect(shouldRetryQuery(0, error)).toBe(status === 0);
    }
    expect(shouldRetryQuery(0, new DOMException("Cancelled", "AbortError"))).toBe(false);
  });
});

/** 模拟请求头或响应体阻塞，接收取消信号后终止请求。 */
function abortableFetch(stage: string) {
  return vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    const signal = options?.signal;
    if (!signal) throw new Error("Missing request signal");
    if (stage === "headers")
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const stream = new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    });
    return Promise.resolve(new Response(stream));
  });
}
