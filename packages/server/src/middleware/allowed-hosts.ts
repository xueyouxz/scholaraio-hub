/**
 * Host-based security validation (Vite model).
 *
 * A shared hostname allowlist backing the Host header check that
 * `hostCheckMiddleware` (security.ts) applies to /api/* and /hub/fs to
 * protect against DNS rebinding.
 *
 * Built-in allowed hostnames:
 * - localhost, 127.0.0.1, ::1, [::1]
 * - Private IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 * - *.ts.net (Tailscale, including nested subdomains)
 *
 * Plus the ALLOWED_HOSTS env var (comma-separated hostnames, or "*" to allow all).
 */

/**
 * Parse ALLOWED_HOSTS env var into a set of hostnames or wildcard (read once at startup).
 */
const ENV_HOSTS: Set<string> | "*" = (() => {
  const raw = process.env.ALLOWED_HOSTS?.trim();
  if (!raw) return new Set<string>();
  if (raw === "*") return "*";
  return new Set(raw.split(",").map((h) => h.trim().toLowerCase()));
})();

/** True when the ALLOWED_HOSTS env var is "*" (disables host checking). */
export function allowAllHosts(): boolean {
  return ENV_HOSTS === "*";
}

/**
 * Core check: is this hostname allowed?
 *
 * Matches against built-in patterns and the ALLOWED_HOSTS env var.
 * Does NOT check for wildcard — callers should check allowAllHosts() first.
 */
export function isAllowedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Localhost variants (IPv4 + IPv6)
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;

  // Private IPv4 ranges
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  // Tailscale (*.ts.net — supports nested subdomains like foo.bar.ts.net)
  if (h.endsWith(".ts.net")) return true;

  // ALLOWED_HOSTS env var entries
  if (ENV_HOSTS !== "*" && ENV_HOSTS.size > 0 && ENV_HOSTS.has(h)) return true;

  return false;
}

/**
 * Validate a Host header value.
 *
 * Strips the port (handling IPv6 bracket syntax) and checks the hostname.
 * Returns true for allowed hosts, false otherwise.
 */
export function isAllowedHost(host: string | undefined): boolean {
  // No Host header = not a browser request (HTTP/1.1 browsers always send Host).
  // No DNS rebinding risk, so allow. Also allows Hono's app.request() in tests.
  if (!host) return true;
  if (allowAllHosts()) return true;

  // Strip port from host header.
  // IPv6 with port: [::1]:3400 → ::1
  // IPv6 without port: [::1] → ::1
  // IPv4 with port: 127.0.0.1:3400 → 127.0.0.1
  // Hostname with port: example.com:3400 → example.com
  let hostname: string;
  if (host.startsWith("[")) {
    // IPv6 bracket syntax
    const closeBracket = host.indexOf("]");
    if (closeBracket === -1) return false; // malformed
    hostname = host.slice(1, closeBracket);
  } else {
    hostname = host.replace(/:\d+$/, "");
  }

  return isAllowedHostname(hostname);
}
