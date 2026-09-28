import { randomUUID } from "node:crypto";
import type { HttpBindings } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { API_ERROR_STATUS, type ApiErrorCode, type ApiErrorDetails } from "@scholaraio-hub/shared";
import type { Context, Env, Hono, HonoRequest, MiddlewareHandler, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "pino";
import type { z } from "zod";
import { LibraryRequestError, LibraryUnavailableError } from "./lib/LibraryClient.js";
import { loggerFor } from "./logging/logger.js";
import { ProjectError } from "./projects/ProjectCatalog.js";
import { ProviderUnavailableError } from "./providers/ProviderRegistry.js";
import {
  SessionConflictError,
  SessionFileTooLargeError,
  SessionInputError,
  SessionNotFoundError,
  SessionResourceNotFoundError,
} from "./sessions/errors.js";

/** 表示可直接向调用方报告的 HTTP 请求错误。 */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: ApiErrorDetails | null = null,
  ) {
    super(message);
  }
}

/** 应用的 Hono 环境：`c.var` 带有本次请求的关联标识和带该标识的 logger。 */
export type AppEnv = {
  Bindings: HttpBindings;
  Variables: { requestId: string; logger: Logger };
};

/**
 * 为请求分配关联标识（写入 `X-Request-ID` 响应头）和带该标识的 logger，并在响应后
 * 记录访问日志：修改请求和失败的请求记为 info，成功的读取记为 debug（页面会定时轮询）。
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = randomUUID();
  const logger = loggerFor("api").child({ requestId: id });
  c.set("requestId", id);
  c.set("logger", logger);
  c.header("X-Request-ID", id);
  const started = performance.now();
  await next();
  const entry = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round(performance.now() - started),
  };
  const read = c.req.method === "GET" || c.req.method === "HEAD";
  if (read && c.res.status < 400) logger.debug(entry, "Request");
  else logger.info(entry, "Request");
};

/** 获取当前请求的关联标识；未经过 `requestContext` 的路由（单独测试时）当场分配一个。 */
function requestId(c: Context): string {
  const existing = c.get("requestId") as string | undefined;
  if (existing) return existing;
  const id = randomUUID();
  c.set("requestId", id);
  c.header("X-Request-ID", id);
  return id;
}

/** 当前请求的 logger，带关联标识。 */
function requestLogger(c: Context): Logger {
  return (
    (c.get("logger") as Logger | undefined) ?? loggerFor("api").child({ requestId: requestId(c) })
  );
}

/** 输出普通 JSON 成功响应。 */
export function success<T>(c: Context, data: T) {
  return c.json({ id: requestId(c), code: "success" as const, message: "success", data }, 200);
}

/** 输出资源创建结果，并可设置资源地址。 */
export function created<T>(c: Context, data: T, location?: string) {
  if (location) c.header("Location", location);
  return c.json({ id: requestId(c), code: "success" as const, message: "success", data }, 201);
}

/** 输出无响应体的成功结果。 */
export function emptyBody(c: Context) {
  return c.body(null, 204);
}

/** 按业务错误码输出统一失败响应。 */
export function errorResponse(
  c: Context,
  code: ApiErrorCode,
  message: string,
  data: ApiErrorDetails | null = null,
) {
  return c.json({ id: requestId(c), code, message, data }, API_ERROR_STATUS[code]);
}

/** 将服务异常和框架异常映射为统一的 HTTP 错误。 */
export function handleApiError(error: Error, c: Context) {
  let mapped: ApiError;
  if (error instanceof ApiError) mapped = error;
  else if (error instanceof SessionNotFoundError)
    mapped = new ApiError("SESSION_NOT_FOUND", error.message);
  else if (error instanceof SessionResourceNotFoundError)
    mapped = new ApiError("RESOURCE_NOT_FOUND", error.message);
  else if (error instanceof SessionFileTooLargeError)
    mapped = new ApiError("PAYLOAD_TOO_LARGE", error.message);
  else if (error instanceof SessionConflictError) mapped = new ApiError(error.code, error.message);
  else if (
    error instanceof SessionInputError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ProjectError
  )
    mapped = new ApiError("VALIDATION_FAILED", error.message);
  else if (error instanceof LibraryUnavailableError)
    mapped = new ApiError(
      error.timedOut ? "LIBRARY_TIMEOUT" : "LIBRARY_UNAVAILABLE",
      error.message,
    );
  else if (error instanceof LibraryRequestError)
    mapped = new ApiError(
      error.status >= 500 ? "UPSTREAM_ERROR" : error.code,
      error.message,
      error.details,
    );
  else if (error instanceof HTTPException) {
    const codes: Partial<Record<ContentfulStatusCode, ApiErrorCode>> = {
      400: "INVALID_JSON",
      413: "PAYLOAD_TOO_LARGE",
      415: "UNSUPPORTED_MEDIA_TYPE",
      404: "ROUTE_NOT_FOUND",
      405: "METHOD_NOT_ALLOWED",
    };
    mapped = new ApiError(codes[error.status] ?? "INTERNAL_ERROR", error.message);
  } else mapped = new ApiError("INTERNAL_ERROR", "Internal server error. Check the service logs.");
  const info = { method: c.req.method, path: c.req.path, code: mapped.code };
  const logger = requestLogger(c);
  if (API_ERROR_STATUS[mapped.code] >= 500) logger.error({ ...info, err: error }, "Request failed");
  else logger.info(info, "Request rejected");
  return errorResponse(c, mapped.code, mapped.message, mapped.details);
}

/** 校验请求字段，并保留校验结果的类型。 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (target === "json" && !isJson(c.req.header("content-type")))
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Request body must be JSON.");
    if (!result.success) throw validationError(result.error, target);
  });
}

/** 将字段校验错误转换为可展示的错误详情。 */
function validationError(
  error: { issues: ReadonlyArray<z.core.$ZodIssue> },
  location: string,
): ApiError {
  return new ApiError("VALIDATION_FAILED", "Invalid request parameters.", {
    issues: error.issues.map((issue) => ({
      location: location === "json" ? "body" : location,
      path: issue.path.map((part) => (typeof part === "number" ? part : String(part))),
      code: issue.code,
      message: issue.message,
    })),
  });
}

/** 解析可选 JSON 请求体并执行字段校验。 */
export async function optionalJson<Schema extends z.ZodType>(
  request: HonoRequest,
  schema: Schema,
): Promise<z.output<Schema>> {
  const text = await request.text();
  let input: unknown = {};
  if (text !== "") {
    if (!isJson(request.header("content-type")))
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Request body must be JSON.");
    try {
      input = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new ApiError("INVALID_JSON", "Invalid JSON request body.");
    }
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, "body");
  return parsed.data;
}

/** 判断媒体类型是否为 JSON。 */
function isJson(type: string | undefined): boolean {
  return /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(type ?? "");
}

/** 为已注册的 API 路径补充方法检查和 Allow 响应头。 */
export function registerMethodFallback<E extends Env>(app: Hono<E>) {
  const paths = new Map<string, Set<string>>();
  for (const route of app.routes) {
    if (route.method === "ALL" || !route.path.startsWith("/api/")) continue;
    const methods = paths.get(route.path) ?? new Set<string>();
    methods.add(route.method);
    if (route.method === "GET") methods.add("HEAD");
    paths.set(route.path, methods);
  }
  for (const [path, methods] of paths)
    app.all(path, (c) => {
      c.header("Allow", [...methods].join(", "));
      return errorResponse(c, "METHOD_NOT_ALLOWED", "Method not allowed for this endpoint.");
    });
}
