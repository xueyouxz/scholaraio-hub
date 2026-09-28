import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  type CreateSessionSchema,
  type LiteratureRef,
  type NewSessionDefaults,
  type ProviderName,
  type SessionAttachment,
  type SessionDetail,
  type SessionInput,
  type SessionSummary,
  type UploadedFile,
  parseSessionKey,
  sessionKey,
  thinkingModeToConfig,
} from "@scholaraio-hub/shared";
import type { UIMessageChunk } from "ai";
import type { z } from "zod";
import { type LibraryClient, LibraryRequestError } from "../lib/LibraryClient.js";
import { loggerFor } from "../logging/logger.js";
import type { ProjectCatalog } from "../projects/ProjectCatalog.js";
import { isDirectory } from "../projects/directories.js";
import { type ProviderRegistry, ProviderUnavailableError } from "../providers/ProviderRegistry.js";
import type { NativeTurn, PermissionMode } from "../providers/types.js";
import type { HubEvents } from "../services/HubEvents.js";
import { researchSlashCommands } from "../skills/scholaraioSkills.js";
import type { ProcessEvent } from "../supervisor/AgentProcess.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { resolvesWithin } from "../utils/timeout.js";
import type { SessionAttachments } from "./SessionAttachments.js";
import type { SessionRecord, SessionStore } from "./SessionStore.js";
import { Turn } from "./Turn.js";
import { prepareAgentPrompt, userText } from "./agent-prompt.js";
import { SessionConflictError, SessionInputError, SessionNotFoundError } from "./errors.js";
import {
  type SessionOptions,
  changeOptions,
  rewindTo,
  setPendingInput,
  startTurn,
} from "./session-record.js";
import { recordedPrompt, transcript } from "./transcript.js";

const log = () => loggerFor("session");

/** How long a stopped turn may take to settle before its worker is terminated. */
const STOP_SETTLE_MS = 3000;
/** How many messages may wait behind a running turn. */
const MAX_QUEUED_MESSAGES = 20;
/** How many sessions' transcripts are kept read, for the pages polling them. */
const HISTORY_CACHE_SIZE = 20;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

type ExecutionInput = Partial<Pick<SessionDetail, "model" | "thinking" | "effort">>;

/** A new-session request as the client sends it; the provider may be left to the defaults. */
export type NewSessionInput = Omit<z.output<typeof CreateSessionSchema>, "provider"> & {
  provider?: ProviderName;
};

export interface SessionServiceOptions {
  store: SessionStore;
  library: LibraryClient;
  /** The providers this server runs; a session that does not name one gets the default. */
  providers: ProviderRegistry;
  /** The provider processes serving these sessions, one per session. */
  supervisor: Supervisor;
  attachments: SessionAttachments;
  /** The sessions the providers keep, for those the Hub has no record of yet. */
  catalog: ProjectCatalog;
  events: HubEvents;
  /** Where sessions started without a directory get one of their own. */
  dataDir: string;
  /** Research skills, offered as commands and expanded into prompts. */
  skillsDir?: string;
}

/** The mode an answer moves the session to: plan tools switch it, "accept edits" keeps accepting. */
function modeAfterAnswer(
  decision: "approve" | "approve_accept_edits" | "deny",
  toolName: string | undefined,
): PermissionMode | undefined {
  if (decision === "approve_accept_edits") return "acceptEdits";
  if (decision !== "approve") return undefined;
  if (toolName === "EnterPlanMode") return "plan";
  if (toolName === "ExitPlanMode") return "default";
  return undefined;
}

/** Both lists' references, each once, the first list's first. */
function mergeReferences(current: LiteratureRef[], added: LiteratureRef[]): LiteratureRef[] {
  const seen = new Set(current.map((ref) => `${ref.kind}:${ref.id}`));
  return [...current, ...added.filter((ref) => !seen.has(`${ref.kind}:${ref.id}`))];
}

/** A session's references as the library's scope: whole collections, and single papers. */
export function scopeOf(references: LiteratureRef[]) {
  return {
    collectionIds: references.flatMap((ref) => (ref.kind === "collection" ? [ref.id] : [])),
    paperIds: references.flatMap((ref) => (ref.kind === "paper" ? [ref.id] : [])),
  };
}

/** A session being created, until its provider names it. */
interface PendingStart {
  resolve: (nativeId: string) => void;
  reject: (error: Error) => void;
}

/**
 * Sessions are the providers' own: Claude Code and Codex keep each
 * conversation, and a session's id is theirs (`sessionKey`). The Hub runs
 * turns in them, and keeps a record of what it adds: the literature a session
 * refers to, the prompts as the user wrote them, citations, options, a queue.
 */
export class SessionService {
  /** The turn each session is running, by session id (a new session's placeholder at first). */
  private turns = new Map<string, Turn>();
  private closing = false;
  private drains = new Map<string, Promise<void>>();
  private changingOptions = new Set<string>();
  private starting = new Map<string, PendingStart>();
  /**
   * Transcripts read lately, with the listing's stamp and the turn (and
   * whether it had ended) at the time: a running turn's history before it
   * does not change, and one that has ended wrote to it.
   */
  private histories = new Map<
    string,
    { stamp?: string; resumeAt?: string; turn?: Turn; ended?: boolean; turns: NativeTurn[] }
  >();
  private readonly store: SessionStore;
  private readonly library: LibraryClient;
  private readonly providers: ProviderRegistry;
  private readonly supervisor: Supervisor;
  private readonly attachments: SessionAttachments;
  private readonly catalog: ProjectCatalog;
  private readonly events: HubEvents;
  private readonly dataDir: string;
  private readonly skillsDir?: string;
  private readonly unsubscribe: () => void;

  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.library = options.library;
    this.providers = options.providers;
    this.supervisor = options.supervisor;
    this.attachments = options.attachments;
    this.catalog = options.catalog;
    this.events = options.events;
    this.dataDir = options.dataDir;
    this.skillsDir = options.skillsDir;
    this.unsubscribe = this.supervisor.subscribe((id, event) => this.onEvent(id, event));
  }

  /** What the Hub is doing in a session now, for the lists. */
  activity(key: string): SessionSummary["state"] {
    const turn = this.turns.get(key);
    if (!turn || turn.finished) return undefined;
    return turn.record.state === "waiting-input" ? "waiting-input" : "running";
  }

  /** Whether the user archived the session. */
  archived(key: string): boolean {
    return this.store.find(key)?.archived === true;
  }

  /**
   * Start a session with its first message. The provider names a new session
   * once it has started it; the session is answered under that name, its turn
   * already running.
   */
  async create(input: NewSessionInput, defaults?: NewSessionDefaults): Promise<SessionDetail> {
    const provider = input.provider ?? defaults?.provider ?? this.providers.defaultProvider.name;
    this.enabled(provider, SessionInputError);
    const model =
      input.model === ""
        ? undefined
        : (input.model ?? (provider === defaults?.provider ? defaults.model : undefined));
    await this.validateExecution(provider, {
      model,
      thinking: input.thinking,
      effort: input.effort,
    });
    const references = mergeReferences(input.references, input.message.references);
    await this.validateScope(references);
    if (this.closing) throw new SessionConflictError("Cannot start sessions now.");
    const cwd = input.cwd ? await this.projectDirectory(input.cwd) : await this.scratch();
    const now = new Date().toISOString();
    const record: SessionRecord = {
      provider,
      nativeId: "",
      cwd,
      ...(model ? { model } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      references,
      prompts: {},
      attachments: randomUUID(),
      state: "idle",
      createdAt: now,
      updatedAt: now,
    };
    // Its id until the provider names it; never shown outside the Hub.
    const placeholder = `pending:${randomUUID()}`;
    const started = new Promise<string>((resolve, reject) => {
      this.starting.set(placeholder, { resolve, reject });
    });
    try {
      const files = await this.attachments.claimDrafts(record, input.message.attachmentIds);
      this.begin(placeholder, record, input.message, files);
      record.nativeId = await started;
    } finally {
      this.starting.delete(placeholder);
    }
    const key = sessionKey(provider, record.nativeId);
    const turn = this.turns.get(placeholder);
    this.turns.delete(placeholder);
    if (turn) {
      turn.key = key;
      this.turns.set(key, turn);
    }
    this.supervisor.rekey(placeholder, key);
    await this.store.keep(record);
    this.catalog.invalidate();
    this.announce();
    return this.detail(key);
  }

  /**
   * The commands a composer can offer: the provider's own (listed by the CLI
   * for the session's directory), then the Hub's research skills, which the
   * Hub itself expands when a message starts with one.
   */
  async commands(key?: string, provider?: ProviderName, cwd?: string) {
    const session = key ? this.parse(key) : undefined;
    const directory = key
      ? await this.workingDirectory(key)
      : cwd
        ? await this.projectDirectory(cwd)
        : path.join(this.dataDir, "draft-workspace");
    await mkdir(directory, { recursive: true });
    const agent = this.providers.get(session?.provider ?? provider);
    const [native, research] = await Promise.all([
      agent.listCommands?.(directory) ?? [],
      this.skillsDir ? researchSlashCommands(this.skillsDir) : [],
    ]);
    const seen = new Set<string>();
    return [...native, ...research].filter((command) => {
      const commandKey = `${command.trigger ?? "/"}${command.name}`;
      if (seen.has(commandKey)) return false;
      seen.add(commandKey);
      return true;
    });
  }

  /** 拒绝未启用的 Provider：新建会话时是输入错误，已有会话继续运行时是状态冲突。 */
  private enabled(
    provider: ProviderName,
    refusal: typeof SessionInputError | typeof SessionConflictError,
  ): void {
    try {
      this.providers.get(provider);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      throw new refusal(error.message);
    }
  }

  /** Refuse papers or literature collections the library does not have. */
  private async validateScope(references: LiteratureRef[]): Promise<void> {
    if (references.length === 0) return;
    try {
      await this.library.checkScope(scopeOf(references));
    } catch (error) {
      if (error instanceof LibraryRequestError && error.status < 500)
        throw new SessionInputError(error.detail);
      throw error;
    }
  }

  /** The directory a new session runs in, as the user named it: it must exist. */
  private async projectDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory) || !(await isDirectory(directory)))
      throw new SessionInputError("The project directory does not exist.");
    return realpath(directory);
  }

  /**
   * A folder of its own for a session started without a project, as the
   * Claude and Codex apps give one.
   */
  private async scratch(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const directory = path.join(this.dataDir, "scratch", day, randomUUID().slice(0, 8));
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private parse(key: string): { provider: ProviderName; nativeId: string } {
    const parsed = parseSessionKey(key);
    if (!parsed) throw new SessionNotFoundError(key);
    return parsed;
  }

  /**
   * The Hub's record of a session, started now for one only its provider
   * knew (a session run from a terminal) the first time the Hub acts on it.
   */
  private async adopt(key: string): Promise<SessionRecord> {
    const existing = this.store.find(key);
    if (existing) return existing;
    const { provider, nativeId } = this.parse(key);
    const listed = await this.catalog.session(provider, nativeId);
    if (!listed) throw new SessionNotFoundError(key);
    return this.store.create({ provider, nativeId, cwd: listed.cwd, attachments: randomUUID() });
  }

  /** The session as the browser shows it: the provider's conversation, with what the Hub adds. */
  async detail(key: string): Promise<SessionDetail> {
    const { provider, nativeId } = this.parse(key);
    const record = this.store.find(key);
    const listed = await this.catalog.session(provider, nativeId);
    const cwd = record?.cwd ?? listed?.cwd;
    if (!cwd) throw new SessionNotFoundError(key);
    const turn = this.turns.get(key);
    const running = turn && !turn.finished ? turn : undefined;
    const history = await this.history(key, cwd, record?.nativeResumeAt, listed?.updatedAt);
    const messages = await transcript(history, record?.prompts ?? {}, key, running?.promptId);
    if (running) messages.push(recordedPrompt(running.prompt, key));
    const firstPrompt = history.find((item) => item.prompt)?.prompt;
    const now = new Date().toISOString();
    return {
      id: key,
      provider,
      nativeId,
      ...(await this.catalog.projectOf(cwd)),
      cwd,
      title: listed?.title || record?.title || userText(firstPrompt ?? "").slice(0, 60),
      ...(record?.model ? { model: record.model } : {}),
      ...(record?.permissionMode ? { permissionMode: record.permissionMode } : {}),
      ...(record?.thinking ? { thinking: record.thinking } : {}),
      ...(record?.effort ? { effort: record.effort } : {}),
      ...(record?.contextUsage ? { contextUsage: record.contextUsage } : {}),
      ...(record?.pendingOptions ? { pendingOptions: record.pendingOptions } : {}),
      references: record?.references ?? [],
      createdAt: record?.createdAt ?? listed?.createdAt ?? now,
      updatedAt: listed?.updatedAt ?? record?.updatedAt ?? now,
      state: record?.state ?? "idle",
      ...(record?.error ? { error: record.error } : {}),
      ...(record?.pendingInput ? { pendingInput: record.pendingInput } : {}),
      messages,
      ...(record?.queuedMessages ? { queuedMessages: record.queuedMessages } : {}),
      ...(record?.queuePaused ? { queuePaused: record.queuePaused } : {}),
      ...(listed?.external ? { external: true } : {}),
    };
  }

  /**
   * The provider's conversation. A running turn's history before it does not
   * change, so pages polling it read it once; otherwise it is read again
   * whenever the provider's listing says the session changed.
   */
  private async history(
    key: string,
    cwd: string,
    resumeAt: string | undefined,
    stamp: string | undefined,
  ): Promise<NativeTurn[]> {
    const cached = this.histories.get(key);
    const turn = this.turns.get(key);
    const running = turn !== undefined && !turn.finished;
    if (
      cached &&
      cached.resumeAt === resumeAt &&
      cached.turn === turn &&
      cached.ended === turn?.finished &&
      (running || (Boolean(stamp) && cached.stamp === stamp))
    )
      return cached.turns;
    const { provider, nativeId } = this.parse(key);
    const turns = await this.providers.get(provider).readSession(nativeId, { cwd, resumeAt });
    this.histories.delete(key);
    this.histories.set(key, { stamp, resumeAt, turn, ended: turn?.finished, turns });
    const oldest = this.histories.keys().next().value;
    if (this.histories.size > HISTORY_CACHE_SIZE && oldest) this.histories.delete(oldest);
    return turns;
  }

  /**
   * Reject an effort the chosen model does not offer. The model is the one the
   * options name, else the session's, else the provider's default; when the
   * provider cannot list its models there is nothing to check against.
   */
  private async validateExecution(
    provider: ProviderName,
    options: ExecutionInput,
    current: ExecutionInput = {},
  ): Promise<void> {
    const effort = options.effort ?? current.effort;
    if (!effort) return;
    const models = await this.providers.get(provider).getAvailableModels();
    if (models.length === 0) return;
    const modelId = Object.hasOwn(options, "model") ? options.model : current.model;
    const model = modelId
      ? models.find((candidate) => candidate.id === modelId)
      : models.find((candidate) => candidate.isDefault);
    if (!model) return;
    if (!model.efforts?.some((option) => option.id === effort))
      throw new SessionInputError(`${model.name} does not support reasoning effort ${effort}`);
  }

  async updateOptions(key: string, input: SessionOptions) {
    const record = await this.adopt(key);
    await this.settled(key);
    if (this.changingOptions.has(key))
      throw new SessionConflictError(
        "Session is busy. Try changing settings later.",
        "SESSION_BUSY",
      );
    this.changingOptions.add(key);
    try {
      await this.validateExecution(record.provider, input, record);
      // The supervisor replaces the process where the next turn's options differ.
      changeOptions(record, input, this.turns.has(key));
      await this.store.save(record);
      return this.detail(key);
    } finally {
      this.changingOptions.delete(key);
    }
  }

  /** Rename or archive a session; the provider's own files are not touched. */
  async update(key: string, input: { title?: string; archived?: boolean }) {
    const record = await this.adopt(key);
    if (input.title !== undefined) record.title = input.title;
    if (input.archived !== undefined) record.archived = input.archived;
    await this.store.save(record);
    this.catalog.invalidate();
    this.announce();
    return this.detail(key);
  }

  /** The literature the session refers to, replaced as a whole. */
  async setReferences(key: string, references: LiteratureRef[]) {
    const record = await this.adopt(key);
    await this.validateScope(references);
    record.references = references;
    await this.store.save(record);
    return this.detail(key);
  }

  /** What the session's process reports; only the turn in progress takes it in. */
  private onEvent(key: string, event: ProcessEvent): void {
    const turn = this.turns.get(key);
    if (!turn || turn.finished) return;
    const { record } = turn;
    if (event.type === "agent") {
      const agentEvent = event.event;
      if (agentEvent.type === "session.started") {
        // A new session: the provider named it.
        this.starting.get(key)?.resolve(agentEvent.sessionId);
        // The process resumed at the rewind's point; what follows now continues from there.
        record.nativeResumeAt = undefined;
      }
      if (agentEvent.type === "context.usage") record.contextUsage = agentEvent.usage;
      turn.accept(agentEvent);
    } else if (event.type === "state-change") {
      const { state } = event;
      setPendingInput(
        record,
        state.type === "waiting-input" ? { ...state.request, sessionId: key } : undefined,
      );
      turn.showState();
      this.announce();
    } else if (turn.interrupted) {
      void turn.finish("Generation stopped.", true);
    } else {
      void turn.finish(
        event.error?.message ?? "The CLI run has ended. Send a new message to continue.",
      );
    }
  }

  async enqueue(key: string, input: SessionInput) {
    const record = await this.adopt(key);
    await Promise.all(
      input.attachmentIds.map((attachmentId) => this.attachments.resolve(record, attachmentId)),
    );
    if (this.closing) throw new SessionConflictError("Cannot queue messages now.");
    record.queuedMessages ??= [];
    const queue = record.queuedMessages;
    if (this.submitted(key, record, input.id) || queue.some((message) => message.id === input.id))
      return this.detail(key);
    if (queue.length >= MAX_QUEUED_MESSAGES)
      throw new SessionConflictError(`At most ${MAX_QUEUED_MESSAGES} messages can be queued`);
    queue.push(input);
    await this.store.save(record);
    void this.drain(key);
    return this.detail(key);
  }

  async editQueue(key: string, action: "resume" | "remove", messageId?: string) {
    const record = await this.adopt(key);
    if (action === "remove")
      record.queuedMessages = record.queuedMessages?.filter((message) => message.id !== messageId);
    else record.queuePaused = false;
    await this.store.save(record);
    if (action === "resume") void this.drain(key);
    return this.detail(key);
  }

  private drain(key: string): Promise<void> {
    const current = this.drains.get(key);
    if (current) return current;
    const pending = (async () => {
      const record = this.store.find(key);
      if (!record || this.closing || record.queuePaused || this.turns.has(key)) return;
      const input = record.queuedMessages?.[0];
      if (!input) return;
      try {
        await this.send(key, input, { queued: true });
      } catch (error) {
        if (error instanceof SessionConflictError && this.turns.has(key)) return;
        record.queuePaused = true;
        record.error = error instanceof Error ? error.message : String(error);
        await this.store.save(record);
      }
    })()
      .catch((error) => log().error({ err: error, sessionKey: key }, "Queue failed"))
      .finally(() => this.drains.delete(key));
    this.drains.set(key, pending);
    return pending;
  }

  /** Whether a message with this id was already sent in the session. */
  private submitted(key: string, record: SessionRecord, inputId: string): boolean {
    if (this.turns.get(key)?.prompt.inputId === inputId) return true;
    return Object.values(record.prompts).some((prompt) => prompt.inputId === inputId);
  }

  /**
   * Start a turn with `input`. With `replaces`, the message corrects the
   * session's last prompt: that turn is cut and this one runs in its place, in
   * one step, as Claude Code's own edit of a sent prompt does.
   */
  async send(
    key: string,
    input: SessionInput,
    { queued = false, replaces }: { queued?: boolean; replaces?: string } = {},
  ): Promise<void> {
    const record = await this.adopt(key);
    const attachments = await Promise.all(
      input.attachmentIds.map((attachmentId) => this.attachments.resolve(record, attachmentId)),
    );
    if (this.changingOptions.has(key))
      throw new SessionConflictError(
        "Session settings are being saved. Try sending later.",
        "SESSION_BUSY",
      );
    if (this.closing) throw new SessionConflictError("Cannot send messages now.");
    this.enabled(record.provider, SessionConflictError);
    if (
      queued &&
      (record.queuePaused || !record.queuedMessages?.some((message) => message.id === input.id))
    )
      return;
    await this.settled(key);
    if (this.turns.has(key))
      throw new SessionConflictError("The session is still running.", "SESSION_BUSY");
    if (input.references.length) {
      const references = mergeReferences(record.references, input.references);
      await this.validateScope(references);
      record.references = references;
    }
    if (replaces) await this.takeBackLastTurn(key, record, replaces);
    if (this.submitted(key, record, input.id))
      throw new SessionConflictError(
        "This message has already been submitted. Refresh the session.",
      );
    this.begin(key, record, input, attachments);
    this.announce();
  }

  /** Run a turn for `input` in the session `key` (a new session's placeholder at first). */
  private begin(
    key: string,
    record: SessionRecord,
    input: SessionInput,
    attachments: Array<{ visible: SessionAttachment; file: UploadedFile }>,
  ): void {
    startTurn(record, input);
    // Claude Code files the prompt under the id it is sent with.
    const promptId = UUID.test(input.id) ? input.id : randomUUID();
    const turn: Turn = new Turn(
      key,
      record,
      {
        promptId,
        inputId: input.id,
        replyId: randomUUID(),
        text: input.text,
        files: attachments.map(({ visible: { url: _, ...file } }) => file),
      },
      // A live process reported its model once; a new one reports it again.
      this.supervisor.get(key)?.resolvedModel ?? record.model,
      {
        // A new session is kept once its provider has named it.
        save: (saved) => (this.store.find(turn.key) ? this.store.save(saved) : Promise.resolve()),
        ended: (ended) => this.ended(ended),
      },
    );
    this.turns.set(key, turn);
    void this.launch(
      turn,
      input,
      attachments.map(({ file }) => file),
    );
  }

  /** Where the agent works: the directory the session runs in. */
  async workingDirectory(key: string): Promise<string> {
    const record = this.store.find(key);
    if (record) return record.cwd;
    const { provider, nativeId } = this.parse(key);
    const listed = await this.catalog.session(provider, nativeId);
    if (!listed) throw new SessionNotFoundError(key);
    return listed.cwd;
  }

  /** Where the session's attachments are kept, started for one that has none yet. */
  async attachmentsOf(key: string): Promise<SessionRecord> {
    return this.adopt(key);
  }

  private async launch(
    turn: Turn,
    input: SessionInput,
    attachments: UploadedFile[],
  ): Promise<void> {
    const { record } = turn;
    try {
      await turn.hooks.save(record);
      const prompt = await prepareAgentPrompt(
        this.library,
        this.skillsDir,
        record.references,
        input.text,
      );
      const { context } = prompt;
      if (turn.finished) return;
      if (context) {
        turn.cite(context.citations);
        if (context.truncated)
          turn.notice("context", {
            level: "info",
            text: "Library excerpts were truncated to fit the context limit.",
          });
      }
      const process = await this.supervisor.send({
        sessionId: turn.key,
        nativeSessionId: record.nativeId || undefined,
        resumeAt: record.nativeResumeAt,
        projectPath: record.cwd,
        additionalDirectories: [await this.attachments.directory(record)],
        message: { text: prompt.text, attachments, uuid: turn.promptId },
        permissionMode: record.permissionMode ?? "default",
        settings: {
          providerName: record.provider,
          model: record.model,
          ...(record.thinking ? { thinking: thinkingModeToConfig(record.thinking) } : {}),
          ...(record.effort ? { effort: record.effort } : {}),
        },
      });
      // Stopped while the process was starting: stop that one, not a later turn's.
      if (turn.finished)
        this.supervisor.release(turn.key, "Application run already stopped", process);
    } catch (error) {
      await turn.finish(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Where a prompt sits in the provider's conversation: its index among the
   * turns, and how many prompts follow it. Only an idle session can be cut.
   */
  private async promptAt(key: string, record: SessionRecord, messageId: string) {
    await this.settled(key);
    if (this.turns.has(key) || this.changingOptions.has(key))
      throw new SessionConflictError(
        "The session is still running. Try again after it ends.",
        "SESSION_BUSY",
      );
    this.histories.delete(key);
    const turns = await this.history(key, record.cwd, record.nativeResumeAt, undefined);
    const index = turns.findIndex(
      (turn) =>
        turn.prompt && (turn.id === messageId || record.prompts[turn.id]?.inputId === messageId),
    );
    if (index < 0) throw new SessionConflictError("Message not found. Refresh the session.");
    const later = turns.slice(index + 1).filter((turn) => turn.prompt).length;
    return { turns, index, later };
  }

  /**
   * A new session holding this one up to the end of the turn `messageId`
   * starts; its agent remembers exactly that much. It keeps working in the
   * same directory, so file changes made later are not undone.
   */
  async fork(key: string, messageId?: string): Promise<SessionDetail> {
    const source = await this.adopt(key);
    const provider = this.providers.get(source.provider);
    if (!provider.forkSession)
      throw new SessionConflictError("This AI provider does not support session forking.");
    const turns = await this.history(key, source.cwd, source.nativeResumeAt, undefined);
    const through = messageId ?? turns.filter((turn) => turn.prompt).at(-1)?.id;
    if (!through) throw new SessionConflictError("The session has no content to fork.");
    const { later } = await this.promptAt(key, source, through);
    const nativeId = await provider.forkSession({
      sessionId: source.nativeId,
      cwd: source.cwd,
      dropTurns: later,
      resumeAt: source.nativeResumeAt,
    });
    const forked = await this.store.create({
      provider: source.provider,
      nativeId,
      cwd: source.cwd,
      attachments: source.attachments,
      ...(source.title ? { title: `${source.title} (fork)` } : {}),
      ...(source.model ? { model: source.model } : {}),
      ...(source.permissionMode ? { permissionMode: source.permissionMode } : {}),
      ...(source.thinking ? { thinking: source.thinking } : {}),
      ...(source.effort ? { effort: source.effort } : {}),
      references: source.references,
    });
    this.catalog.invalidate();
    this.announce();
    return this.detail(sessionKey(forked.provider, forked.nativeId));
  }

  /**
   * Cut the last turn, which `messageId` must start, for a correction to run
   * in its place: the provider rewinds its own session, keeping its id and
   * prompt cache, and files the agent changed stay. The session's process
   * holds the turn in memory, so it stops before the provider cuts.
   */
  private async takeBackLastTurn(
    key: string,
    record: SessionRecord,
    messageId: string,
  ): Promise<void> {
    const { turns, index, later } = await this.promptAt(key, record, messageId);
    if (later > 0)
      throw new SessionConflictError("Only the last message can be edited or taken back.");
    if (!turns.slice(0, index).some((turn) => turn.prompt))
      throw new SessionConflictError(
        "The first message of a session cannot be edited. Start a new session instead.",
      );
    const provider = this.providers.get(record.provider);
    if (!provider.rewindSession)
      throw new SessionConflictError("This AI provider cannot take back a turn.");
    await this.supervisor.release(key, "Session rewound");
    const rewind = await provider.rewindSession({
      sessionId: record.nativeId,
      cwd: record.cwd,
      dropTurns: 1,
      resumeAt: record.nativeResumeAt,
    });
    if (rewind.sessionId !== record.nativeId)
      throw new SessionConflictError(
        "This session cannot take back a turn in place. Fork it from an earlier message instead.",
      );
    rewindTo(record, turns[index]?.id ?? messageId, rewind.resumeAt);
    this.histories.delete(key);
    await this.store.save(record);
  }

  /**
   * The turn in progress, replayed from its start and then live; null when the
   * session is not running one.
   */
  stream(key: string, signal: AbortSignal): ReadableStream<UIMessageChunk> | null {
    this.parse(key);
    const turn = this.turns.get(key);
    // An ended turn is in the transcript already.
    return turn && !turn.finished ? turn.attach(signal) : null;
  }

  /** A turn that is ending holds the session until its record is saved. */
  private async settled(key: string): Promise<void> {
    const turn = this.turns.get(key);
    if (turn?.finished) await turn.done;
  }

  /** A turn has ended: the session is free, and an idle one sends what is queued. */
  private ended(turn: Turn): void {
    const { key } = turn;
    if (this.turns.get(key) === turn) this.turns.delete(key);
    // A new session that ended before its provider named it did not start.
    this.starting
      .get(key)
      ?.reject(new SessionInputError(turn.record.error ?? "The session could not start."));
    // The provider wrote the turn; read it again next time.
    this.histories.delete(key);
    this.catalog.invalidate();
    this.announce();
    if (turn.record.state === "idle") void this.drain(key);
  }

  async stop(key: string): Promise<void> {
    const record = await this.adopt(key);
    record.queuePaused = true;
    await this.store.save(record);
    const turn = this.turns.get(key);
    if (!turn || turn.finished) return;
    turn.interrupted = true;
    const process = this.supervisor.get(key);
    // An idle process has not been handed this turn's message yet: there is no
    // turn to interrupt, and the turn's launch sees it finished and sends nothing.
    if (process && process.state.type !== "idle") {
      // Interrupt the turn and let it settle, so the worker stays for the next
      // message. One that cannot interrupt, or does not settle in time, is
      // terminated; the next message resumes its native session.
      const settled = await resolvesWithin(
        process.interrupt().then((supported) => {
          if (!supported) throw new Error("interrupt unsupported");
          return turn.done;
        }),
        STOP_SETTLE_MS,
      );
      if (!settled) this.supervisor.release(key, "User interrupted application run");
    }
    await turn.finish("Generation stopped.", true);
  }

  /**
   * Answer the process's pending question or approval. An answer can move the
   * session to another permission mode (see `modeAfterAnswer`); the session
   * keeps it, and so does the live process.
   */
  input(
    key: string,
    requestId: string,
    decision: "approve" | "approve_accept_edits" | "deny",
    answers?: Record<string, string>,
  ): boolean {
    const process = this.supervisor.get(key);
    const request = process?.respondToInput(
      requestId,
      decision === "deny" ? "deny" : "approve",
      answers,
    );
    if (!process || !request) return false;
    const mode = modeAfterAnswer(decision, request.toolName);
    const record = this.store.find(key);
    if (mode && record) {
      process.setPermissionMode(mode);
      record.permissionMode = mode;
      void this.store.save(record).catch((error) => {
        log().error({ err: error, sessionKey: key }, "Permission mode save failed");
      });
    }
    return true;
  }

  /** Tell open pages the sessions' lists changed. */
  private announce(): void {
    this.events.publish({ type: "sessions" });
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.drains.values());
    for (const turn of this.turns.values())
      await turn.finish("The run was interrupted by service shutdown.", true);
    this.unsubscribe();
  }
}
