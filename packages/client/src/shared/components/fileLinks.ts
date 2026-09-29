import { createContext } from "react";

/** A file an answer links to: a path in the session's working directory, maybe a line range. */
export interface FileLink {
  path: string;
  line?: number;
  endLine?: number;
}

/**
 * Opens a linked file where the reader is. Provided by an open session; without
 * one, a link to a file is left as plain text.
 */
export const FileLinkContext = createContext<((link: FileLink) => void) | null>(null);

/** `path:12`, `path:12:4`, `path:12-30`, or GitHub's `path#L12`, `path#L12-L30`. */
const LOCATION =
  /^(.*?)(?::(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?|#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?)?$/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DRIVE = /^[a-z]:[\\/]/i;

const lineNumber = (value: string | undefined) => {
  const number = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return number >= 1 ? number : undefined;
};

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The file a link's target names, when it is a path on disk rather than a web
 * address: agents link `src/app.ts:42` or `/abs/path/app.ts#L42`.
 */
export function parseFileLink(href: string | undefined): FileLink | undefined {
  let target = href?.trim() ?? "";
  if (target.startsWith("file://")) target = target.slice("file://".length);
  if (!target || /^[#?]/.test(target) || target.startsWith("//") || target.startsWith("/library/"))
    return undefined;
  const [, path = "", line, endLine, hashLine, hashEndLine] = LOCATION.exec(target) ?? [];
  if (!path || (SCHEME.test(path) && !DRIVE.test(path))) return undefined;
  // A bare word before a colon is a scheme (`javascript:1`), not a file and its line.
  if (line && !/[./\\]/.test(path)) return undefined;
  const start = lineNumber(line ?? hashLine);
  const end = lineNumber(endLine ?? hashEndLine);
  return {
    path: decode(path),
    ...(start ? { line: start } : {}),
    ...(start && end && end > start ? { endLine: end } : {}),
  };
}

/**
 * Where a file link points once Markdown has marked it: a fragment, which
 * Streamdown's sanitizer and link filter keep as it is. They would otherwise
 * drop the target before any component sees it: a bare `src/app.ts` is blocked
 * as relative, and `README.md:42` reads like a `readme.md:` scheme.
 */
const FILE_HREF = "#hub-file:";

interface MarkdownNode {
  type: string;
  url?: unknown;
  children?: MarkdownNode[];
}

function markFileLinks(node: MarkdownNode) {
  if (
    (node.type === "link" || node.type === "definition") &&
    typeof node.url === "string" &&
    parseFileLink(node.url)
  )
    node.url = `${FILE_HREF}${encodeURIComponent(node.url)}`;
  for (const child of node.children ?? []) markFileLinks(child);
}

/** A remark plugin: link targets that name files are marked before sanitizing. */
export const remarkFileLinks = () => markFileLinks;

/** The file a rendered link points at, when Markdown marked it as one. */
export function fileLinkOf(href: string | undefined): FileLink | undefined {
  if (!href?.startsWith(FILE_HREF)) return undefined;
  return parseFileLink(decode(href.slice(FILE_HREF.length)));
}

/** A path with its `.` and `..` segments folded, the way the server resolves it. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." && segments.length && segments.at(-1) !== "..") segments.pop();
    else if (segment !== ".." || !absolute) segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}

/** A link written in a file, resolved against the directory that file is in. */
export function relativeTo(file: string, link: FileLink): FileLink {
  if (link.path.startsWith("/") || DRIVE.test(link.path)) return link;
  const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return { ...link, path: normalizePath(`${directory}${link.path}`) };
}
