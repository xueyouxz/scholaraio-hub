/** 业务错误码及其对应的 HTTP 状态。 */
export const API_ERROR_STATUS = {
  INVALID_JSON: 400,
  INVALID_MULTIPART: 400,
  HOST_NOT_ALLOWED: 403,
  CSRF_REJECTED: 403,
  CORS_REJECTED: 403,
  RESOURCE_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  PAPER_NOT_FOUND: 404,
  COLLECTION_NOT_FOUND: 404,
  SKILL_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  STATE_CONFLICT: 409,
  SESSION_BUSY: 409,
  APPROVAL_EXPIRED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
  LIBRARY_UNAVAILABLE: 503,
  LIBRARY_TIMEOUT: 504,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;
export interface ApiErrorDetails {
  issues: Array<{
    location: string;
    path: Array<string | number>;
    code: string;
    message: string;
  }>;
}
export interface ApiSuccess<T> {
  id: string;
  code: "success";
  message: string;
  data: T;
}
export interface ApiFailure {
  id: string;
  code: ApiErrorCode;
  message: string;
  data: ApiErrorDetails | null;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 检查响应外壳，返回可供调用方读取的协议数据。 */
export function parseApiResponse(value: unknown): ApiResponse<unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("code" in value) ||
    typeof value.code !== "string" ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    !("data" in value) ||
    (value.code !== "success" && !Object.hasOwn(API_ERROR_STATUS, value.code))
  )
    throw new Error("Invalid API response format");
  return value as ApiResponse<unknown>;
}
