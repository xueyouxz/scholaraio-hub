import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSessionSchema,
  NewSessionDefaults,
  ProviderName,
  SessionInput,
  StoredSession,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { thinkingModeToConfig } from "@scholaraio-hub/shared";
import type { UIMessageChunk } from "ai";
import type { z } from "zod";
import { type LibraryClient, LibraryRequestError } from "../lib/LibraryClient.js";
import { loggerFor } from "../logging/logger.js";
import { type ProviderRegistry, ProviderUnavailableError } from "../providers/ProviderRegistry.js";
import type { NativeRewind, PermissionMode } from "../providers/types.js";
import { researchSlashCommands } from "../skills/scholaraioSkills.js";
import type { ProcessEvent } from "../supervisor/AgentProcess.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { resolvesWithin } from "../utils/timeout.js";
import type { SessionAttachments } from "./SessionAttachments.js";
import type { SessionRecord, SessionStore } from "./SessionStore.js";
import { Turn } from "./Turn.js";
import { prepareAgentPrompt } from "./agent-prompt.js";
import { SessionConflictError, SessionInputError } from "./errors.js";
import {
  type SessionOptions,
  changeOptions,
  rewindTo,
  setPendingInput,
  startTurn,
} from "./session-record.js";

const log = () => loggerFor("session");

/** How long a stopped turn may take to settle before its worker is terminated. */
const STOP_SETTLE_MS = 3000;
/** How many messages may wait behind a running turn. */
const MAX_QUEUED_MESSAGES = 20;

type ExecutionInput = Partial<Pick<StoredSession, "model" | "thinking" | "effort">>;

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

export class SessionService {
  private turns = new Map<string, Turn>();
  private closing = false;
  private drains = new Map<string, Promise<void>>();
  private changingOptions = new Set<string>();
  private readonly store: SessionStore;
  private readonly library: LibraryClient;
  private readonly providers: ProviderRegistry;
  private readonly supervisor: Supervisor;
  private readonly attachments: SessionAttachments;
  private readonly skillsDir?: string;
  private readonly unsubscribe: () => void;

  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.library = options.library;
    this.providers = options.providers;
    this.supervisor = options.supervisor;
    this.attachments = options.attachments;
    this.skillsDir = options.skillsDir;
    this.unsubscribe = this.supervisor.subscribe((id, event) => this.onEvent(id, event));
  }

  /** Every session, newest first, without its messages. */
  list() {
    return this.store.list();
  }

  /**
   * Create a session. The client may leave the provider and model to the
   * new-session defaults; draft uploads named in the request move into it.
   */
  async create(input: NewSessionInput, defaults?: NewSessionDefaults): Promise<StoredSession> {
    const provider = input.provider ?? defaults?.provider ?? this.providers.defaultProvider.name;
    this.enabled(provider, SessionInputError);
    const model =
      input.model === ""
        ? undefined
        : (input.model ?? (provider === defaults?.provider ? defaults.model : undefined));
    const { attachmentIds, ...fields } = input;
    const request = { ...fields, provider, model };
    await this.validateScope(request);
    await this.validateExecution(provider, request);
    const record = await this.store.create(request);
    await this.attachments.claimDrafts(record.id, attachmentIds);
    return this.store.toStoredSession(record);
  }

  /**
   * The commands a composer can offer: the provider's own (listed by the CLI
   * for this session's workspace), then the hub's research skills, which the
   * hub itself expands when a message starts with one.
   */
  async commands(id?: string, provider?: ProviderName) {
    const record = id ? this.store.get(id) : undefined;
    const workspace = record
      ? await this.workingDirectory(record)
      : path.join(this.store.dataDir, "draft-workspace");
    await mkdir(workspace, { recursive: true });
    const agent = this.providers.get(record?.provider ?? provider);
    const [native, research] = await Promise.all([
      agent.listCommands?.(workspace) ?? [],
      this.skillsDir ? researchSlashCommands(this.skillsDir) : [],
    ]);
    const seen = new Set<string>();
    return [...native, ...research].filter((command) => {
      const key = `${command.trigger ?? "/"}${command.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
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

  /** Refuse papers or a literature collection the library does not have. */
  private async validateScope(input: { projectId?: string; paperIds: string[] }): Promise<void> {
    if (!input.projectId && input.paperIds.length === 0) return;
    const { projectId, paperIds } = input;
    try {
      await this.library.checkScope({ collectionIds: projectId ? [projectId] : [], paperIds });
    } catch (error) {
      if (error instanceof LibraryRequestError && error.status < 500)
        throw new SessionInputError(error.detail);
      throw error;
    }
  }

  detail(id: string) {
    const data = this.store.toStoredSession(this.store.get(id));
    const turn = this.turns.get(id);
    // Active messages are replayed from their beginning, never appended twice.
    if (turn && !turn.finished)
      data.messages = data.messages.filter((message) => message.id !== turn.assistantId);
    return data;
  }

  /**
   * Reject an effort the chosen model does not offer. The model is the one the
   * options name, else the session's, else the provider's default; when the
   * provider cannot list its models there is nothing to check against.
   */
  private async validateExecution(
    provider: StoredSession["provider"],
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

  async updateOptions(id: string, input: SessionOptions) {
    const record = this.store.get(id);
    await this.settled(id);
    if (record.readOnly || this.changingOptions.has(id))
      throw new SessionConflictError(
        "Session is busy. Try changing settings later.",
        "SESSION_BUSY",
      );
    this.changingOptions.add(id);
    try {
      await this.validateExecution(record.provider, input, record);
      // The supervisor replaces the process where the next turn's options differ.
      changeOptions(record, input, this.turns.has(id));
      await this.store.save(record);
      return this.store.toStoredSession(record);
    } finally {
      this.changingOptions.delete(id);
    }
  }

  /** What the session's process reports; only the turn in progress takes it in. */
  private onEvent(id: string, event: ProcessEvent): void {
    const turn = this.turns.get(id);
    if (!turn || turn.finished) return;
    const { record } = turn;
    if (event.type === "agent") {
      const agentEvent = event.event;
      // The provider's id for the conversation; the next turn resumes it.
      if (agentEvent.type === "session.started") {
        record.nativeSessionId = agentEvent.sessionId;
        // The process resumed at the rewind's point; what follows now continues from there.
        record.nativeResumeAt = undefined;
      }
      if (agentEvent.type === "context.usage") record.contextUsage = agentEvent.usage;
      turn.accept(agentEvent);
    } else if (event.type === "state-change") {
      const { state } = event;
      setPendingInput(
        record,
        state.type === "waiting-input" ? { ...state.request, sessionId: id } : undefined,
      );
      turn.showState();
    } else if (turn.interrupted) {
      void turn.finish("Generation stopped.", true);
    } else {
      void turn.finish(
        event.error?.message ?? "The CLI run has ended. Send a new message to continue.",
      );
    }
  }

  async enqueue(id: string, input: SessionInput) {
    await Promise.all(
      input.attachmentIds.map((attachmentId) => this.attachments.resolve(id, attachmentId)),
    );
    const record = this.store.get(id);
    if (record.readOnly || this.closing)
      throw new SessionConflictError("Cannot queue messages in the current session");
    record.queuedMessages ??= [];
    const queue = record.queuedMessages;
    if (
      record.messages.some((message) => message.id === input.id) ||
      queue.some((message) => message.id === input.id)
    )
      return this.detail(id);
    if (queue.length >= MAX_QUEUED_MESSAGES)
      throw new SessionConflictError(`At most ${MAX_QUEUED_MESSAGES} messages can be queued`);
    queue.push(input);
    await this.store.save(record);
    void this.drain(id);
    return this.detail(id);
  }

  async editQueue(id: string, action: "resume" | "remove", messageId?: string) {
    const record = this.store.get(id);
    if (record.readOnly) throw new SessionConflictError("Historical sessions are read-only");
    if (action === "remove")
      record.queuedMessages = record.queuedMessages?.filter((message) => message.id !== messageId);
    else record.queuePaused = false;
    await this.store.save(record);
    if (action === "resume") void this.drain(id);
    return this.detail(id);
  }

  private drain(id: string): Promise<void> {
    const current = this.drains.get(id);
    if (current) return current;
    const pending = (async () => {
      const record = this.store.get(id);
      if (this.closing || record.queuePaused || this.turns.has(id)) return;
      const input = record.queuedMessages?.[0];
      if (!input) return;
      try {
        await this.send(id, input, { queued: true });
      } catch (error) {
        if (error instanceof SessionConflictError && this.turns.has(id)) return;
        record.queuePaused = true;
        record.error = error instanceof Error ? error.message : String(error);
        await this.store.save(record);
      }
    })()
      .catch((error) => log().error({ err: error, sessionId: id }, "Queue failed"))
      .finally(() => this.drains.delete(id));
    this.drains.set(id, pending);
    return pending;
  }

  /**
   * Start a turn with `input`. With `replaces`, the message corrects the
   * session's last prompt: that turn is cut and this one runs in its place, in
   * one step, as Claude Code's own edit of a sent prompt does.
   */
  async send(
    id: string,
    input: SessionInput,
    { queued = false, replaces }: { queued?: boolean; replaces?: string } = {},
  ): Promise<void> {
    const attachments = await Promise.all(
      input.attachmentIds.map((attachmentId) => this.attachments.resolve(id, attachmentId)),
    );
    if (this.changingOptions.has(id))
      throw new SessionConflictError(
        "Session settings are being saved. Try sending later.",
        "SESSION_BUSY",
      );
    const record = this.store.get(id);
    if (record.readOnly || this.closing)
      throw new SessionConflictError("Cannot send messages in the current session.");
    this.enabled(record.provider, SessionConflictError);
    if (
      queued &&
      (record.queuePaused || !record.queuedMessages?.some((message) => message.id === input.id))
    )
      return;
    await this.settled(id);
    if (this.turns.has(id))
      throw new SessionConflictError("The session is still running.", "SESSION_BUSY");
    if (replaces) await this.takeBackLastTurn(record, replaces);
    if (record.messages.some((message) => message.id === input.id))
      throw new SessionConflictError(
        "This message has already been submitted. Refresh the session.",
      );
    startTurn(
      record,
      input,
      attachments.map(({ visible }) => visible),
    );
    const turn = new Turn(
      record,
      randomUUID(),
      // A live process reported its model once; a new one reports it again.
      this.supervisor.get(id)?.resolvedModel ?? record.model,
      { save: (saved) => this.store.save(saved), ended: (turn) => this.ended(turn) },
    );
    this.turns.set(id, turn);
    void this.launch(
      turn,
      input,
      attachments.map(({ file }) => file),
    );
  }

  /**
   * Where the agent works: the session's own directory. A literature
   * collection is only the papers the agent reads, never a place it works in.
   */
  async workingDirectory(session: string | SessionRecord): Promise<string> {
    const record = typeof session === "string" ? this.store.get(session) : session;
    return this.store.workspace(record);
  }

  private async launch(
    turn: Turn,
    input: SessionInput,
    attachments: UploadedFile[],
  ): Promise<void> {
    const { record } = turn;
    const id = record.id;
    try {
      await this.store.save(record);
      const prompt = await prepareAgentPrompt(this.library, this.skillsDir, record, input.text);
      const { context } = prompt;
      if (turn.finished) return;
      if (context) {
        turn.emit({ type: "data-citations", id: "citations", data: context.citations });
        if (context.truncated)
          turn.emit({
            type: "data-notice",
            id: "context",
            data: {
              level: "info",
              text: "Library excerpts were truncated to fit the context limit.",
            },
          });
      }
      const projectPath = await this.workingDirectory(record);
      // Stopped while the prompt was being prepared: nothing to send.
      if (turn.finished) return;
      const process = await this.supervisor.send({
        sessionId: id,
        nativeSessionId: record.nativeSessionId,
        resumeAt: record.nativeResumeAt,
        projectPath,
        message: { text: prompt.text, attachments },
        permissionMode: record.permissionMode ?? "default",
        settings: {
          providerName: record.provider,
          model: record.model,
          ...(record.thinking ? { thinking: thinkingModeToConfig(record.thinking) } : {}),
          ...(record.effort ? { effort: record.effort } : {}),
        },
      });
      // Stopped while the process was starting: stop that one, not a later turn's.
      if (turn.finished) this.supervisor.release(id, "Application run already stopped", process);
    } catch (error) {
      await turn.finish(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Where a user turn sits: its index among the messages, and how many user
   * turns follow it. Only an idle, writable session can be cut.
   */
  private async turnAt(record: SessionRecord, messageId: string) {
    await this.settled(record.id);
    if (record.readOnly)
      throw new SessionConflictError("Imported historical sessions cannot be edited or forked.");
    if (this.turns.has(record.id) || this.changingOptions.has(record.id))
      throw new SessionConflictError(
        "The session is still running. Try again after it ends.",
        "SESSION_BUSY",
      );
    const index = record.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    if (index < 0) throw new SessionConflictError("Message not found. Refresh the session.");
    const later = record.messages.slice(index + 1).filter((message) => message.role === "user");
    return { index, later: later.length };
  }

  /** The native session without its last `dropTurns` turns, or none when nothing is kept. */
  private async forkNative(
    record: SessionRecord,
    dropTurns: number,
    keepsAny: boolean,
  ): Promise<string | undefined> {
    if (!record.nativeSessionId || !keepsAny) return undefined;
    const provider = this.providers.get(record.provider);
    if (!provider.forkSession)
      throw new SessionConflictError("This AI provider does not support session forking.");
    return provider.forkSession({
      sessionId: record.nativeSessionId,
      cwd: await this.workingDirectory(record),
      dropTurns,
      resumeAt: record.nativeResumeAt,
    });
  }

  /**
   * A new session holding this one up to the end of the turn `messageId`
   * starts; its agent remembers exactly that much. It keeps working in the
   * same directory, so file changes made later are not undone.
   */
  async fork(id: string, messageId?: string): Promise<StoredSession> {
    const source = this.store.get(id);
    // Without a turn named, the whole conversation is copied.
    const lastPrompt = source.messages.filter((message) => message.role === "user").at(-1)?.id;
    const through = messageId ?? lastPrompt;
    if (!through) throw new SessionConflictError("The session has no content to fork.");
    const { index, later } = await this.turnAt(source, through);
    const nextUser = source.messages.findIndex(
      (message, position) => position > index && message.role === "user",
    );
    const messages = source.messages.slice(0, nextUser < 0 ? undefined : nextUser);
    const nativeSessionId = await this.forkNative(source, later, true);
    const record = await this.store.create({
      title: `${source.title} (fork)`,
      provider: source.provider,
      paperIds: source.paperIds,
      model: source.model,
      projectId: source.projectId,
      permissionMode: source.permissionMode,
      thinking: source.thinking,
      effort: source.effort,
    });
    record.messages = structuredClone(messages);
    record.nativeSessionId = nativeSessionId;
    if (!source.projectId) record.workspaceSessionId = source.workspaceSessionId ?? source.id;
    await this.store.save(record);
    return this.store.toStoredSession(record);
  }

  /**
   * Cut the last turn, which `messageId` must start, for a correction to run
   * in its place: the provider rewinds its own session, keeping its id and
   * prompt cache, and files the agent changed stay. The session's process
   * holds the turn in memory, so it stops before the provider cuts.
   */
  private async takeBackLastTurn(record: SessionRecord, messageId: string): Promise<void> {
    const { index, later } = await this.turnAt(record, messageId);
    if (later > 0)
      throw new SessionConflictError("Only the last message can be edited or taken back.");
    const keepsAny = record.messages.slice(0, index).some((message) => message.role === "user");
    await this.supervisor.release(record.id, "Session rewound");
    rewindTo(record, index, await this.rewindNative(record, keepsAny));
  }

  /** The provider's rewind of its session by one turn; none when no turn is kept. */
  private async rewindNative(
    record: SessionRecord,
    keepsAny: boolean,
  ): Promise<NativeRewind | undefined> {
    if (!record.nativeSessionId || !keepsAny) return undefined;
    const provider = this.providers.get(record.provider);
    if (!provider.rewindSession)
      throw new SessionConflictError("This AI provider cannot take back a turn.");
    return provider.rewindSession({
      sessionId: record.nativeSessionId,
      cwd: await this.workingDirectory(record),
      dropTurns: 1,
      resumeAt: record.nativeResumeAt,
    });
  }

  async rename(id: string, title: string): Promise<StoredSession> {
    const record = this.store.get(id);
    record.title = title;
    await this.store.save(record);
    return this.detail(id);
  }

  /** Stop whatever the session is running, then remove it. */
  async delete(id: string): Promise<void> {
    const record = this.store.get(id);
    record.queuedMessages = [];
    await this.stop(id);
    await this.drains.get(id);
    this.supervisor.release(id, "Session deleted");
    await this.store.remove(id);
  }

  /**
   * The turn in progress, replayed from its start and then live; null when the
   * session is not running one. An unknown session throws.
   */
  stream(id: string, signal: AbortSignal): ReadableStream<UIMessageChunk> | null {
    this.store.get(id);
    return this.turns.get(id)?.attach(signal) ?? null;
  }

  /** A turn that is ending holds the session until its record is saved. */
  private async settled(id: string): Promise<void> {
    const turn = this.turns.get(id);
    if (turn?.finished) await turn.done;
  }

  /** A turn has ended: the session is free, and an idle one sends what is queued. */
  private ended(turn: Turn): void {
    const { id } = turn.record;
    if (this.turns.get(id) === turn) this.turns.delete(id);
    if (turn.record.state === "idle") void this.drain(id);
  }

  async stop(id: string): Promise<void> {
    const record = this.store.get(id);
    record.queuePaused = true;
    await this.store.save(record);
    const turn = this.turns.get(id);
    if (!turn || turn.finished) return;
    turn.interrupted = true;
    const process = this.supervisor.get(id);
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
      if (!settled) this.supervisor.release(id, "User interrupted application run");
    }
    await turn.finish("Generation stopped.", true);
  }

  /**
   * Answer the process's pending question or approval. An answer can move the
   * session to another permission mode (see `modeAfterAnswer`); the session
   * keeps it, and so does the live process.
   */
  input(
    id: string,
    requestId: string,
    decision: "approve" | "approve_accept_edits" | "deny",
    answers?: Record<string, string>,
  ): boolean {
    const process = this.supervisor.get(id);
    const request = process?.respondToInput(
      requestId,
      decision === "deny" ? "deny" : "approve",
      answers,
    );
    if (!process || !request) return false;
    const mode = modeAfterAnswer(decision, request.toolName);
    if (mode) {
      process.setPermissionMode(mode);
      const record = this.store.get(id);
      record.permissionMode = mode;
      void this.store.save(record).catch((error) => {
        log().error({ err: error, sessionId: id }, "Permission mode save failed");
      });
    }
    return true;
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.drains.values());
    for (const turn of this.turns.values())
      await turn.finish("The run was interrupted by service shutdown.", true);
    this.unsubscribe();
  }
}
