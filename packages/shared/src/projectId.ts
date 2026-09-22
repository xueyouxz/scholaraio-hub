/**
 * Branded types for project identification.
 *
 * Two formats exist:
 * - UrlProjectId: base64url of absolute path (reversible)
 * - DirProjectId: slash-to-hyphen encoding (lossy, NOT reversible)
 *
 * Using branded types makes format mismatches a compile-time error.
 */

/** Base64url encoded absolute path - used in URLs, API, client state */
export type UrlProjectId = string & { readonly __brand: "UrlProjectId" };

/** Directory-format path suffix - used in ~/.claude/projects/ file paths */
export type DirProjectId = string & { readonly __brand: "DirProjectId" };

/**
 * Create UrlProjectId from absolute path.
 * Uses browser-compatible base64url encoding.
 */
export function toUrlProjectId(absolutePath: string): UrlProjectId {
  // TextEncoder works in both browser and Node
  const bytes = new TextEncoder().encode(absolutePath);
  // Convert to base64, then to base64url (replace +/= with -_)
  const base64 = btoa(String.fromCharCode(...bytes));
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return base64url as UrlProjectId;
}
