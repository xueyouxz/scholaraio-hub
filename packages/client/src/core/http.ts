export interface ApiRequestOptions {
  signal?: AbortSignal;
}

export type QueryParams = object;

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly payload: unknown;

  constructor(message: string, response: Response, payload: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.payload = payload;
  }
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function withQuery(path: string, params: QueryParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (typeof error === "string" && error.trim()) return error;

    const message = payload.message;
    if (typeof message === "string" && message.trim()) return message;

    const detail = payload.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (isRecord(item) && typeof item.msg === "string") return item.msg;
          if (typeof item === "string") return item;
          return null;
        })
        .filter((item): item is string => !!item);
      if (messages.length > 0) return messages.join("; ");
    }
  }

  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback || "Request failed";
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
  const headers = new Headers(init?.headers);
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
    throw new HttpError(getErrorMessage(payload, response.statusText), response, payload);
  }

  return payload as T;
}
