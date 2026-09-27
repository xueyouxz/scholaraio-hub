import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type StoredSession, isProviderName, readLegacyThinking } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import { writeFileAtomic } from "../utils/write-file-atomic.js";
import { SessionNotFoundError } from "./errors.js";
import { recoverAfterRestart } from "./session-record.js";

const log = () => loggerFor("session-store");

export interface SessionRecord extends StoredSession {
  nativeSessionId?: string;
  /**
   * A fork works in the directory of the session it was forked from: Claude
   * Code files a transcript by its working directory, so the forked native
   * session only resumes there.
   */
  workspaceSessionId?: string;
}

/** Application-owned records; native CLI transcripts remain owned by their provider. */
export class SessionStore {
  private records = new Map<string, SessionRecord>();
  private writes = new Map<string, Promise<void>>();
  constructor(readonly dataDir: string) {}

  directory(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid session id");
    return path.join(this.dataDir, "sessions", id);
  }

  /** The private working directory of a session that has no literature project. */
  workspace(record: SessionRecord): string {
    return path.join(this.directory(record.workspaceSessionId ?? record.id), "workspace");
  }

  async initialize(): Promise<void> {
    const base = path.join(this.dataDir, "sessions");
    await mkdir(base, { recursive: true });
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const data = await this.load(base, entry.name);
      if (!data) continue;
      this.records.set(data.id, data);
      if (data.thinking && data.thinking !== "off" && data.thinking !== "adaptive") {
        Object.assign(data, readLegacyThinking(data.thinking));
        await this.save(data);
      }
      if (recoverAfterRestart(data)) await this.save(data);
    }
  }

  /**
   * One stored session, or undefined when the directory holds none. A record
   * that cannot be read is set aside (renamed, never deleted) so one damaged
   * file does not keep every other session from loading.
   */
  private async load(base: string, name: string): Promise<SessionRecord | undefined> {
    const file = path.join(base, name, "session.json");
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      // A deleted session whose workspace its forks still use keeps only its directory.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const data = JSON.parse(content) as SessionRecord;
      if (data.id !== name || !Array.isArray(data.messages) || !isProviderName(data.provider))
        throw new Error("the record does not describe this session");
      return data;
    } catch (error) {
      const aside = `${file}.corrupt-${Date.now()}`;
      await rename(file, aside);
      log().error({ err: error, sessionId: name, movedTo: aside }, "Unreadable session set aside");
      return undefined;
    }
  }

  get(id: string): SessionRecord {
    const record = this.records.get(id);
    if (!record) throw new SessionNotFoundError(id);
    return record;
  }

  list(): StoredSession[] {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => {
        const {
          nativeSessionId: _native,
          workspaceSessionId: _workspace,
          messages: _messages,
          ...summary
        } = record;
        return { ...structuredClone(summary), messages: [] };
      });
  }

  toStoredSession(record: SessionRecord): StoredSession {
    const { nativeSessionId: _native, workspaceSessionId: _workspace, ...visible } = record;
    return structuredClone(visible);
  }

  async create(
    input: Pick<
      StoredSession,
      | "title"
      | "provider"
      | "paperIds"
      | "model"
      | "projectId"
      | "permissionMode"
      | "thinking"
      | "effort"
    >,
  ): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      readOnly: false,
      state: "idle",
      messages: [],
    };
    await mkdir(path.join(this.directory(record.id), "workspace"), { recursive: true });
    await this.save(record);
    this.records.set(record.id, record);
    return record;
  }

  /**
   * Write the record atomically. Writes of one session go out in order; each
   * caller hears how its own write went, and a failed write does not stop the
   * ones queued behind it.
   */
  save(record: SessionRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    const content = JSON.stringify(record);
    const file = path.join(this.directory(record.id), "session.json");
    const previous = this.writes.get(record.id) ?? Promise.resolve();
    const next = previous.then(() => writeFileAtomic(file, content));
    // What later writes wait on: settled either way, since `next`'s caller has its failure.
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.writes.set(record.id, settled);
    void settled.then(() => {
      if (this.writes.get(record.id) === settled) this.writes.delete(record.id);
    });
    return next;
  }

  /**
   * Forget a session and remove its files. When forks still work in its
   * directory, the directory stays and only the record goes. Provider-native
   * transcripts are the provider's and are left alone.
   */
  async remove(id: string): Promise<void> {
    this.get(id);
    // Only wait for a pending write to settle; its caller has its outcome.
    await this.writes.get(id);
    this.records.delete(id);
    const shared = [...this.records.values()].some((record) => record.workspaceSessionId === id);
    if (shared) await rm(path.join(this.directory(id), "session.json"), { force: true });
    else await rm(this.directory(id), { recursive: true, force: true });
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }
}
