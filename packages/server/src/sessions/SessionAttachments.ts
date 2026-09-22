import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ATTACHMENT_LIMITS,
  type SessionAttachment,
  type UploadedFile,
} from "@scholaraio-hub/shared";
import type { SessionStore } from "./SessionStore.js";

export class AttachmentError extends Error {}
export const MAX_ATTACHMENT_BYTES = ATTACHMENT_LIMITS.maxBytes;

/** Only opaque IDs cross the HTTP boundary; CLI paths are resolved inside the owned workspace. */
export class SessionAttachments {
  constructor(private store: SessionStore) {}

  private async folder(sessionId: string) {
    this.store.get(sessionId);
    const workspace = path.join(await realpath(this.store.directory(sessionId)), "workspace");
    const folder = path.join(workspace, ".attachments");
    await mkdir(folder, { recursive: true });
    if ((await realpath(workspace)) !== workspace || (await realpath(folder)) !== folder)
      throw new AttachmentError("附件目录不能使用符号链接");
    return folder;
  }

  async upload(sessionId: string, file: File): Promise<SessionAttachment> {
    if (this.store.get(sessionId).readOnly) throw new AttachmentError("只读会话不能上传附件");
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
      throw new AttachmentError("附件不能为空，且单个文件不能超过 25 MB");
    const folder = await this.folder(sessionId);
    const id = randomUUID();
    const filename =
      path
        .basename(file.name)
        .split("")
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join("")
        .slice(0, 180) || "attachment";
    const extension = path
      .extname(filename)
      .replace(/[^.a-zA-Z0-9]/g, "")
      .slice(0, 20);
    const name = `${id}${extension}`;
    const metadata = {
      id,
      filename,
      name,
      size: file.size,
      mediaType: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
      url: `/api/sessions/${sessionId}/attachments/${id}`,
    };
    await writeFile(path.join(folder, name), Buffer.from(await file.arrayBuffer()), {
      flag: "wx",
      mode: 0o600,
    });
    const manifests = path.join(this.store.directory(sessionId), "attachments");
    await mkdir(manifests, { recursive: true });
    await writeFile(path.join(manifests, `${id}.json`), JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
    const { name: _name, ...visible } = metadata;
    return visible;
  }

  async resolve(
    sessionId: string,
    id: string,
  ): Promise<{ visible: SessionAttachment; file: UploadedFile }> {
    this.store.get(sessionId);
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id))
      throw new AttachmentError("附件不存在");
    const folder = await this.folder(sessionId);
    let metadata: SessionAttachment & { name: string };
    try {
      metadata = JSON.parse(
        await readFile(
          path.join(this.store.directory(sessionId), "attachments", `${id}.json`),
          "utf8",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AttachmentError("附件不属于当前会话或已被移除");
      throw error;
    }
    if (metadata.id !== id || path.basename(metadata.name) !== metadata.name)
      throw new AttachmentError("附件记录无效");
    const filePath = path.join(folder, metadata.name);
    if ((await realpath(filePath)) !== filePath) throw new AttachmentError("附件不能使用符号链接");
    const info = await stat(filePath);
    if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES)
      throw new AttachmentError("附件文件无效");
    const { name, ...visible } = metadata;
    return {
      visible,
      file: {
        id,
        name,
        path: filePath,
        originalName: metadata.filename,
        size: info.size,
        mimeType: metadata.mediaType,
      },
    };
  }
}
