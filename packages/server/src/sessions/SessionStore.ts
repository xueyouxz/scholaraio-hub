import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type StoredSession, readLegacyThinking } from "@scholaraio-hub/shared";

export interface SessionRecord extends StoredSession {
  nativeSessionId?: string;
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

  async initialize(): Promise<void> {
    const base = path.join(this.dataDir, "sessions");
    await mkdir(base, { recursive: true });
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const data = JSON.parse(
        await readFile(path.join(base, entry.name, "session.json"), "utf8"),
      ) as SessionRecord;
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
    if (!record) throw new Error("Session not found");
    return record;
  }

  list(): StoredSession[] {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => {
        const { nativeSessionId: _native, messages: _messages, ...summary } = record;
        return { ...structuredClone(summary), messages: [] };
      });
  }

  public(record: SessionRecord): StoredSession {
    const { nativeSessionId: _native, ...visible } = record;
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

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }
}
