import { CSRF_HEADER } from "@scholaraio-hub/shared";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "../http.js";
import { loggerFor } from "../logging/logger.js";

/**
 * Which Host headers the API answers: the loopback names, plus `ALLOWED_HOSTS`
 * (comma-separated hostnames, or "*" for any). Checking it stops DNS
 * rebinding — a page on another origin resolving its name to this machine.
 */
export type AllowedHosts = ReadonlySet<string> | "*";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

export function parseAllowedHosts(value: string | undefined): AllowedHosts {
  const raw = value?.trim();
  if (raw === "*") return "*";
  const extra = raw ? raw.split(",").map((host) => host.trim().toLowerCase()) : [];
  return new Set([...LOOPBACK_HOSTS, ...extra.filter(Boolean)]);
}

/**
 * Whether a Host header value names an allowed host. A request without one is
 * not a browser's (HTTP/1.1 browsers always send it), so it carries no
 * rebinding risk; Hono's `app.request()` in tests is such a request.
 */
export function isAllowedHost(host: string | undefined, allowed: AllowedHosts): boolean {
  if (!host || allowed === "*") return true;
  let hostname: string;
  if (host.startsWith("[")) {
    // IPv6: [::1]:3400 or [::1]
    const close = host.indexOf("]");
    if (close === -1) return false;
    hostname = host.slice(1, close);
  } else {
    hostname = host.replace(/:\d+$/, "");
  }
  return allowed.has(hostname.toLowerCase());
}

export function hostCheck(allowed: AllowedHosts): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    if (!isAllowedHost(host, allowed)) {
      loggerFor("security").warn({ host }, "Rejected request with a disallowed Host");
      const hostname = (host ?? "(unknown)").replace(/:\d+$/, "");
      return errorResponse(
        c,
        "HOST_NOT_ALLOWED",
        `Host not allowed: ${hostname}. Configure ALLOWED_HOSTS to allow it.`,
      );
    }
    await next();
  };
}

// Only required on mutating requests: SSE uses EventSource, which cannot send headers.
export const requireCsrfHeader: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (c.req.header(CSRF_HEADER.name) !== CSRF_HEADER.value) {
      return errorResponse(c, "CSRF_REJECTED", "Request is missing a required header.");
    }
  }
  await next();
};
