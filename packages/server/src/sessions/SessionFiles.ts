import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { SessionDirectoryListing, SessionFileContent } from "@scholaraio-hub/shared";
import { MAX_ATTACHMENT_BYTES } from "./SessionAttachments.js";
import type { SessionStore } from "./SessionStore.js";
import { SessionInputError } from "./errors.js";

export class SessionFiles {
  constructor(private store: SessionStore) {}

  private async resolve(id: string, relative: string) {
    const base = await realpath(this.store.workspace(this.store.get(id)));
    const candidate = path.resolve(base, relative);
    if (
      relative.includes("\0") ||
      (candidate !== base && !candidate.startsWith(`${base}${path.sep}`))
    )
      throw new SessionInputError("只能读取当前会话工作目录中的文件");
    const target = await realpath(candidate);
    if (target !== candidate || (target !== base && !target.startsWith(`${base}${path.sep}`)))
      throw new SessionInputError("不能读取符号链接文件");
    return target;
  }

  async browse(id: string, relative: string): Promise<SessionDirectoryListing> {
    const target = await this.resolve(id, relative);
    const entries = (await readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        isDir: entry.isDirectory(),
        isDotfile: entry.name.startsWith("."),
      }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return { path: relative, entries };
  }

  async read(id: string, relative: string, raw = false): Promise<Buffer> {
    const target = await this.resolve(id, relative);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new SessionInputError("请选择文件");
      if (raw && info.size > MAX_ATTACHMENT_BYTES)
        throw new SessionInputError("下载文件不能超过 25 MB");
      const buffer = Buffer.alloc(Math.min(info.size, raw ? MAX_ATTACHMENT_BYTES : 1024 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async preview(id: string, relative: string): Promise<SessionFileContent> {
    const buffer = await this.read(id, relative);
    return {
      content: buffer.includes(0) ? undefined : buffer.toString("utf8"),
      truncated: buffer.length === 1024 * 1024,
      rawUrl: `/api/sessions/${id}/fs/raw?path=${encodeURIComponent(relative)}`,
    };
  }
}
