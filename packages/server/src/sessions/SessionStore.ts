import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import {
  type LibraryCitation,
  type ProviderName,
  type SessionAttachment,
  type SessionDetail,
  type SessionMessage,
  type SessionMessageMetadata,
  type SessionNotice,
  isProviderName,
  sessionKey,
} from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import { writeFileAtomic } from "../utils/write-file-atomic.js";
import { recoverAfterRestart } from "./session-record.js";

const log = () => loggerFor("session-store");

/**
 * What the Hub sent as one prompt, and what it added to the answer. The
 * provider's transcript holds the prompt as the agent received it (with the
 * library passages appended); the conversation shows it as the user wrote it.
 */
export interface PromptRecord {
  /** The message id the browser sent it under. */
  inputId: string;
  /** The id the answer streamed under, so it keeps it once read back from the transcript. */
  replyId: string;
  text: string;
  /** The files sent with it; their addresses follow from the session's id. */
  files: Array<Omit<SessionAttachment, "url">>;
  citations?: LibraryCitation[];
  notices?: SessionNotice[];
  metadata?: SessionMessageMetadata;
  /**
   * What the answer had shown when the turn was stopped or failed: the
   * provider's transcript may not have kept a reply cut short.
   */
  reply?: SessionMessage["parts"];
}

/**
 * What the Hub keeps about a session its provider stores: how it runs, what
 * literature it refers to, its queue, and what the Hub added to each prompt it
 * sent. The conversation itself is the provider's (see `readSession`).
 */
export interface SessionRecord
  extends Pick<
    SessionDetail,
    | "provider"
    | "nativeId"
    | "cwd"
    | "model"
    | "permissionMode"
    | "thinking"
    | "effort"
    | "contextUsage"
    | "pendingOptions"
    | "references"
    | "createdAt"
    | "updatedAt"
    | "state"
    | "error"
    | "pendingInput"
    | "queuedMessages"
    | "queuePaused"
  > {
  /** A title the user gave it; the provider's own otherwise. */
  title?: string;
  /** The folder its attachments are kept in, under the data directory's `attachments/`. */
  attachments: string;
  /** Left out of the lists; nothing on disk changes. */
  archived?: boolean;
  /** Prompts the Hub sent, by the provider's id for each. */
  prompts: Record<string, PromptRecord>;
  /**
   * Where the next launch resumes the native session from, after a rewind the
   * provider applies on resume. Cleared once a process has resumed there.
   */
  nativeResumeAt?: string;
}

export type NewSessionRecord = Pick<
  SessionRecord,
  "provider" | "nativeId" | "cwd" | "attachments"
> &
  Partial<Omit<SessionRecord, "provider" | "nativeId" | "cwd" | "attachments">>;

/** The Hub's records of sessions, one JSON file each under `session-records/<provider>/`. */
export class SessionStore {
  private records = new Map<string, SessionRecord>();
  private writes = new Map<string, Promise<void>>();
  constructor(readonly dataDir: string) {}

  private file(provider: ProviderName, nativeId: string): string {
    return path.join(this.dataDir, "session-records", provider, `${nativeId}.json`);
  }

  async initialize(): Promise<void> {
    const base = path.join(this.dataDir, "session-records");
    await mkdir(base, { recursive: true });
    for (const provider of await readdir(base)) {
      if (!isProviderName(provider)) continue;
      for (const entry of await readdir(path.join(base, provider))) {
        if (!entry.endsWith(".json")) continue;
        const record = await this.load(provider, entry.slice(0, -".json".length));
        if (!record) continue;
        this.records.set(sessionKey(record.provider, record.nativeId), record);
        if (recoverAfterRestart(record)) await this.save(record);
      }
    }
  }

  /**
   * One record, or undefined when the file holds none. A record that cannot
   * be read is set aside (renamed, never deleted) so one damaged file does
   * not keep every other session from loading.
   */
  private async load(provider: ProviderName, nativeId: string): Promise<SessionRecord | undefined> {
    const file = this.file(provider, nativeId);
    const content = await readFile(file, "utf8");
    try {
      const data = JSON.parse(content) as SessionRecord;
      if (data.provider !== provider || data.nativeId !== nativeId || !data.prompts)
        throw new Error("the record does not describe this session");
      return data;
    } catch (error) {
      const aside = `${file}.corrupt-${Date.now()}`;
      await rename(file, aside);
      log().error({ err: error, file, movedTo: aside }, "Unreadable session record set aside");
      return undefined;
    }
  }

  /** The Hub's record of a session, if it has one. */
  find(key: string): SessionRecord | undefined {
    return this.records.get(key);
  }

  /** Start keeping a record of a session, or return the one kept already. */
  async create(input: NewSessionRecord): Promise<SessionRecord> {
    const key = sessionKey(input.provider, input.nativeId);
    const existing = this.records.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      references: [],
      prompts: {},
      state: "idle",
      createdAt: now,
      ...input,
      updatedAt: now,
    };
    this.records.set(key, record);
    await this.save(record);
    return record;
  }

  /** Keep a record made elsewhere (a new session, once its provider named it). */
  keep(record: SessionRecord): Promise<void> {
    this.records.set(sessionKey(record.provider, record.nativeId), record);
    return this.save(record);
  }

  /**
   * Write the record atomically. Writes of one session go out in order; each
   * caller hears how its own write went, and a failed write does not stop the
   * ones queued behind it.
   */
  save(record: SessionRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    const key = sessionKey(record.provider, record.nativeId);
    const content = JSON.stringify(record);
    const file = this.file(record.provider, record.nativeId);
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, content);
    });
    // What later writes wait on: settled either way, since `next`'s caller has its failure.
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.writes.set(key, settled);
    void settled.then(() => {
      if (this.writes.get(key) === settled) this.writes.delete(key);
    });
    return next;
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }
}
