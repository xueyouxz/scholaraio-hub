import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ATTACHMENT_LIMITS,
  type SessionAttachment,
  type UploadedFile,
} from "@scholaraio-hub/shared";
import type { SessionStore } from "./SessionStore.js";
import { SessionInputError } from "./errors.js";

export const MAX_ATTACHMENT_BYTES = ATTACHMENT_LIMITS.maxBytes;
/** Drafts never claimed by a new session are removed after this long. */
export const DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

const ATTACHMENT_ID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

type Manifest = SessionAttachment & { name: string };

/** Where one owner's files and their manifests live. */
interface Area {
  folder: string;
  manifests: string;
  url: (id: string) => string;
}

/**
 * Files attached to messages. Only opaque IDs cross the HTTP boundary; CLI
 * paths are resolved inside the owned workspace. A new chat uploads into a
 * draft area first and the session claims those files when it is created.
 */
export class SessionAttachments {
  constructor(private store: SessionStore) {}

  private async sessionArea(sessionId: string): Promise<Area> {
    this.store.get(sessionId);
    const workspace = path.join(await realpath(this.store.directory(sessionId)), "workspace");
    const folder = path.join(workspace, ".attachments");
    await mkdir(folder, { recursive: true });
    if ((await realpath(workspace)) !== workspace || (await realpath(folder)) !== folder)
      throw new SessionInputError("附件目录不能使用符号链接");
    return {
      folder,
      manifests: path.join(this.store.directory(sessionId), "attachments"),
      url: (id) => `/api/sessions/${sessionId}/attachments/${id}`,
    };
  }

  private async draftArea(): Promise<Area> {
    const root = path.join(await realpath(this.store.dataDir), "draft-attachments");
    const folder = path.join(root, "files");
    await mkdir(folder, { recursive: true });
    if ((await realpath(folder)) !== folder)
      throw new SessionInputError("附件目录不能使用符号链接");
    return {
      folder,
      manifests: path.join(root, "manifests"),
      url: (id) => `/api/sessions/draft-attachments/${id}`,
    };
  }

  private async write(area: Area, file: File): Promise<SessionAttachment> {
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
      throw new SessionInputError("附件不能为空，且单个文件不能超过 25 MB");
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
    const metadata: Manifest = {
      id,
      filename,
      name,
      size: file.size,
      mediaType: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
      url: area.url(id),
    };
    await writeFile(path.join(area.folder, name), Buffer.from(await file.arrayBuffer()), {
      flag: "wx",
      mode: 0o600,
    });
    await mkdir(area.manifests, { recursive: true });
    await writeFile(path.join(area.manifests, `${id}.json`), JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
    const { name: _name, ...visible } = metadata;
    return visible;
  }

  private async read(area: Area, id: string): Promise<{ metadata: Manifest; filePath: string }> {
    if (!ATTACHMENT_ID.test(id)) throw new SessionInputError("附件不存在");
    let metadata: Manifest;
    try {
      metadata = JSON.parse(await readFile(path.join(area.manifests, `${id}.json`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new SessionInputError("附件不属于当前会话或已被移除");
      throw error;
    }
    if (metadata.id !== id || path.basename(metadata.name) !== metadata.name)
      throw new SessionInputError("附件记录无效");
    const filePath = path.join(area.folder, metadata.name);
    if ((await realpath(filePath)) !== filePath)
      throw new SessionInputError("附件不能使用符号链接");
    const info = await stat(filePath);
    if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES)
      throw new SessionInputError("附件文件无效");
    return { metadata, filePath };
  }

  private async resolveIn(
    area: Area,
    id: string,
  ): Promise<{ visible: SessionAttachment; file: UploadedFile }> {
    const { metadata, filePath } = await this.read(area, id);
    const { name, ...visible } = metadata;
    return {
      visible,
      file: {
        id,
        name,
        path: filePath,
        originalName: metadata.filename,
        size: (await stat(filePath)).size,
        mimeType: metadata.mediaType,
      },
    };
  }

  async upload(sessionId: string, file: File): Promise<SessionAttachment> {
    if (this.store.get(sessionId).readOnly) throw new SessionInputError("只读会话不能上传附件");
    return this.write(await this.sessionArea(sessionId), file);
  }

  resolve(
    sessionId: string,
    id: string,
  ): Promise<{ visible: SessionAttachment; file: UploadedFile }> {
    this.store.get(sessionId);
    return this.sessionArea(sessionId).then((area) => this.resolveIn(area, id));
  }

  /**
   * Remove a file the user took back before sending. Files a sent or queued
   * message refers to stay: the transcript and the queue still need them.
   */
  async remove(sessionId: string, id: string): Promise<void> {
    const record = this.store.get(sessionId);
    const area = await this.sessionArea(sessionId);
    const { metadata, filePath } = await this.read(area, id);
    const sent = record.messages.some((message) =>
      message.parts.some((part) => part.type === "file" && part.url === metadata.url),
    );
    const queued = record.queuedMessages?.some((message) => message.attachmentIds.includes(id));
    if (sent || queued) throw new SessionInputError("已发送或排队的附件不能删除");
    await rm(filePath, { force: true });
    await rm(path.join(area.manifests, `${id}.json`), { force: true });
  }

  /** Upload for a chat that has no session yet; see {@link claimDrafts}. */
  async uploadDraft(file: File): Promise<SessionAttachment> {
    await this.sweepDrafts();
    return this.write(await this.draftArea(), file);
  }

  async removeDraft(id: string): Promise<void> {
    const area = await this.draftArea();
    const { filePath } = await this.read(area, id);
    await rm(filePath, { force: true });
    await rm(path.join(area.manifests, `${id}.json`), { force: true });
  }

  /** Move draft uploads into a new session; they keep their ids. */
  async claimDrafts(sessionId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const drafts = await this.draftArea();
    const session = await this.sessionArea(sessionId);
    await mkdir(session.manifests, { recursive: true });
    for (const id of ids) {
      const { metadata, filePath } = await this.read(drafts, id);
      await rename(filePath, path.join(session.folder, metadata.name));
      await writeFile(
        path.join(session.manifests, `${id}.json`),
        JSON.stringify({ ...metadata, url: session.url(id) }),
        { flag: "wx", mode: 0o600 },
      );
      await rm(path.join(drafts.manifests, `${id}.json`), { force: true });
    }
  }

  /** Drop drafts older than the TTL; runs on each draft upload, never on a timer. */
  async sweepDrafts(now = Date.now()): Promise<void> {
    const area = await this.draftArea();
    let entries: string[];
    try {
      entries = await readdir(area.manifests);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const manifest = path.join(area.manifests, entry);
      const info = await stat(manifest);
      if (now - info.mtimeMs < DRAFT_ATTACHMENT_TTL_MS) continue;
      const id = entry.replace(/\.json$/, "");
      try {
        const { filePath } = await this.read(area, id);
        await rm(filePath, { force: true });
      } catch (error) {
        console.warn("[Attachments] Removing unreadable draft", id, error);
      }
      await rm(manifest, { force: true });
    }
  }
}
