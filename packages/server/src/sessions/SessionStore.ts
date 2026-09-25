import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type StoredSession, readLegacyThinking } from "@scholaraio-hub/shared";
import { SessionNotFoundError } from "./errors.js";

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
      const file = path.join(base, entry.name, "session.json");
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch (error) {
        // A deleted session whose workspace its forks still use keeps only its directory.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const data = JSON.parse(content) as SessionRecord;
      if (
        data.id !== entry.name ||
        !Array.isArray(data.messages) ||
        !["claude", "codex"].includes(data.provider)
      )
        throw new Error(`Invalid session record: ${entry.name}`);
      this.records.set(data.id, data);
      if (data.thinking && data.thinking !== "off" && data.thinking !== "adaptive") {
        Object.assign(data, readLegacyThinking(data.thinking));
        await this.save(data);
      }
      if (data.queuedMessages?.length) {
        data.queuePaused = true;
        await this.save(data);
      }
      if (data.state === "running" || data.state === "waiting-input") {
        data.state = "interrupted";
        data.pendingInput = undefined;
        data.error = "服务重启中断了上一轮，可发送新消息继续。";
        await this.save(data);
      }
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
   * Point every session at a renamed project, or detach them from a removed
   * one. Returns how many sessions changed.
   */
  async retargetProject(projectId: string, replacement?: string): Promise<number> {
    const affected = [...this.records.values()].filter((record) => record.projectId === projectId);
    for (const record of affected) {
      record.projectId = replacement;
      await this.save(record);
    }
    return affected.length;
  }

  save(record: SessionRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    const content = JSON.stringify(record);
    const file = path.join(this.directory(record.id), "session.json");
    const previous = this.writes.get(record.id) ?? Promise.resolve();
    const next = previous
      .catch((error) => console.error("[SessionStore] previous write failed", error))
      .then(async () => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, file);
      });
    this.writes.set(record.id, next);
    void next
      .finally(() => {
        if (this.writes.get(record.id) === next) this.writes.delete(record.id);
      })
      .catch((error) => console.error("[SessionStore] save failed", error));
    return next;
  }

  /**
   * Forget a session and remove its files. When forks still work in its
   * directory, the directory stays and only the record goes. Provider-native
   * transcripts are the provider's and are left alone.
   */
  async remove(id: string): Promise<void> {
    this.get(id);
    // Only wait for a pending write to settle: save() has already logged one that failed.
    await this.writes.get(id)?.catch(() => undefined);
    this.records.delete(id);
    const shared = [...this.records.values()].some((record) => record.workspaceSessionId === id);
    if (shared) await rm(path.join(this.directory(id), "session.json"), { force: true });
    else await rm(this.directory(id), { recursive: true, force: true });
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }
}
