import { CSRF_HEADER } from "@scholaraio-hub/shared";

/** JSON transport shared by every client API module (`core/library.ts`). */

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Headers for any request to the Hub API, with the CSRF header the server
 * requires on mutations. Every request goes through here, whatever sends it.
 */
export function hubHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set(CSRF_HEADER.name, CSRF_HEADER.value);
  return headers;
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The server answers every failure as `{ error: message }` (the library service too). */
function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim())
    return payload.error;
  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback || "请求失败";
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  return response.text();
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = hubHeaders(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new HttpError(getErrorMessage(payload, response.statusText), response.status);
  }

  return payload as T;
}
