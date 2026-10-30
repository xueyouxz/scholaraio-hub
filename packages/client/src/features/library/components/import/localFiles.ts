/**
 * Turning whatever the user picked on disk — PDFs, folders, or both, as many
 * times as they like — into one list of files the import queue will accept.
 *
 * The browser checks what it can before anything is uploaded, so the list the
 * user confirms is the list that gets imported.
 */

/** The import route's limits for one upload. */
export const MAX_BATCH_FILES = 500;
export const MAX_BATCH_BYTES = 500 * 1024 * 1024;

export interface LocalCandidate {
  key: string;
  file: File;
  /** Where the file sits in the folder it came from, or just its name. */
  path: string;
}

export interface RejectedFile {
  path: string;
  reason: string;
}

/**
 * One key per file on disk, whichever way it was picked: by itself, or inside
 * a folder, where only its relative path differs.
 */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function relativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

/** Files a folder carries that nobody meant to pick: dotfiles and archive debris. */
function incidental(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");
}

/**
 * Sort picked files into those worth checking and those refused, with why.
 *
 * `known` holds the keys already in the list, so picking a folder twice, or a
 * file that is also inside a picked folder, lists it once.
 */
export function screenFiles(
  files: Iterable<File>,
  known: ReadonlySet<string>,
): { accepted: LocalCandidate[]; rejected: RejectedFile[] } {
  const accepted: LocalCandidate[] = [];
  const rejected: RejectedFile[] = [];
  const seen = new Set(known);
  for (const file of files) {
    const path = relativePath(file);
    if (incidental(path)) continue;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      rejected.push({ path, reason: "不是 PDF" });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ path, reason: "空文件" });
      continue;
    }
    if (file.size > MAX_BATCH_BYTES) {
      rejected.push({ path, reason: "超过 500 MB" });
      continue;
    }
    const key = fileKey(file);
    if (seen.has(key)) {
      rejected.push({ path, reason: "已在列表中" });
      continue;
    }
    seen.add(key);
    accepted.push({ key, file, path });
  }
  return { accepted, rejected };
}

/** Whether the file starts like a PDF, whatever its name says. */
export async function looksLikePdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.includes("%PDF-");
}

/** Split what is to be uploaded into requests the import route accepts. */
export function uploadBatches<T>(items: T[], size: (item: T) => number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const next = size(item);
    if (current.length && (current.length >= MAX_BATCH_FILES || bytes + next > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += next;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** What a typed text names, if it is an identifier rather than a topic. */
export function locatorIn(text: string): string | null {
  const value = text.trim();
  if (/^(?:doi:\s*)?10\.\d{4,9}\/\S+$/i.test(value)) return value.replace(/^doi:\s*/i, "");
  if (/^(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(value)) return value;
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  return null;
}
