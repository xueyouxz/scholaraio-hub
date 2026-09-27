import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSessionSchema,
  LibraryContext,
  LiteratureProject,
  NewSessionDefaults,
  ProviderName,
  SessionInput,
  SessionMessage,
  SessionMessageMetadata,
  StoredSession,
  UploadedFile,
} from "@scholaraio-hub/shared";
import { UNTITLED_SESSION_TITLE, thinkingModeToConfig } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import type { z } from "zod";
import { type LibraryClient, LibraryRequestError } from "../lib/LibraryClient.js";
import { loggerFor } from "../logging/logger.js";
import { type ProviderRegistry, ProviderUnavailableError } from "../providers/ProviderRegistry.js";
import type { PermissionMode } from "../providers/types.js";
import { researchSlashCommands } from "../skills/scholaraioSkills.js";
import type { ProcessEvent } from "../supervisor/AgentProcess.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { resolvesWithin } from "../utils/timeout.js";
import type { SessionAttachments } from "./SessionAttachments.js";
import type { SessionRecord, SessionStore } from "./SessionStore.js";
import { UIChunkWriter, appendReplayChunk } from "./UIChunkWriter.js";
import { agentPrompt, requestedSkill } from "./agent-prompt.js";
import { SessionConflictError, SessionInputError } from "./errors.js";

const log = () => loggerFor("session");

/** How long a stopped turn may take to settle before its worker is terminated. */
const STOP_SETTLE_MS = 3000;
/** How often a running turn's progress is written to disk, at most. */
const CHECKPOINT_INTERVAL_MS = 1000;
/** How many messages may wait behind a running turn. */
const MAX_QUEUED_MESSAGES = 20;
/** How much of the first message becomes the session's title. */
const TITLE_LENGTH = 60;
/** How much of a question is sent to the library to find passages for it. */
const CONTEXT_QUERY_LENGTH = 20_000;

interface SessionRun {
  record: SessionRecord;
  assistantId: string;
  chunks: UIMessageChunk[];
  listeners: Set<(chunk: UIMessageChunk | null) => void>;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  /** Turns this run's AgentEvents into UI chunks. */
  writer: UIChunkWriter;
  /** Model and usage for this turn, sent as message metadata when it ends. */
  metadata: SessionMessageMetadata;
  startedAt: number;
  consume: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  finished: boolean;
  interrupted?: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

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
  private runs = new Map<string, SessionRun>();
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

  /** Refuse papers or a project the library does not have. */
  private async validateScope(input: { projectId?: string; paperIds: string[] }): Promise<void> {
    if (!input.projectId && input.paperIds.length === 0) return;
    const { projectId, paperIds } = input;
    try {
      await this.library.checkScope({ projectId, paperIds });
    } catch (error) {
      if (error instanceof LibraryRequestError && error.status < 500)
        throw new SessionInputError(error.detail);
      throw error;
    }
  }

  detail(id: string) {
    const data = this.store.toStoredSession(this.store.get(id));
    const run = this.runs.get(id);
    // Active messages are replayed from their beginning, never appended twice.
    if (run && !run.finished)
      data.messages = data.messages.filter((message) => message.id !== run.assistantId);
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

  async updateOptions(
    id: string,
    input: Pick<StoredSession, "model" | "permissionMode" | "thinking" | "effort">,
  ) {
    const record = this.store.get(id);
    const previous = this.runs.get(id);
    if (previous?.finished) await previous.done;
    if (record.readOnly || this.changingOptions.has(id))
      throw new SessionConflictError(
        "Session is busy. Try changing settings later.",
        "SESSION_BUSY",
      );
    this.changingOptions.add(id);
    try {
      await this.validateExecution(record.provider, input, record);
      // A running turn keeps the options it started with; the next turn gets
      // these, and the supervisor replaces the process where they differ.
      if (this.runs.has(id)) {
        const changed = (Object.keys(input) as Array<keyof typeof input>).filter(
          (key) => input[key] !== undefined,
        );
        record.pendingOptions = [...new Set([...(record.pendingOptions ?? []), ...changed])];
      }
      Object.assign(record, input);
      if (input.model === "") record.model = undefined;
      if (input.effort === "") record.effort = undefined;
      await this.store.save(record);
      return this.store.toStoredSession(record);
    } finally {
      this.changingOptions.delete(id);
    }
  }

  /** What the session's process reports; only the run in progress takes it in. */
  private onEvent(id: string, event: ProcessEvent): void {
    const run = this.runs.get(id);
    if (run && !run.finished) {
      const { record } = run;
      if (event.type === "agent") {
        const agentEvent = event.event;
        // The provider's id for the conversation; the next turn resumes it.
        if (agentEvent.type === "session.started") record.nativeSessionId = agentEvent.sessionId;
        if (agentEvent.type === "model.resolved") run.metadata.model = agentEvent.model;
        if (agentEvent.type === "context.usage") record.contextUsage = agentEvent.usage;
        if (agentEvent.type === "turn.completed") {
          if (agentEvent.usage) run.metadata.usage = agentEvent.usage;
          if (agentEvent.contextWindow) run.metadata.contextWindow = agentEvent.contextWindow;
        }
        run.writer.write(agentEvent);
        if (agentEvent.type === "turn.completed") void this.finish(run, agentEvent.error);
      } else if (event.type === "state-change") {
        record.pendingInput =
          event.state.type === "waiting-input"
            ? { ...event.state.request, sessionId: id }
            : undefined;
        record.state = record.pendingInput ? "waiting-input" : "running";
        this.broadcast(run, {
          type: "data-session-state",
          data: { state: record.state, pendingInput: record.pendingInput },
          transient: true,
        });
        this.checkpoint(run);
      } else if (event.type === "terminated") {
        if (run.interrupted) void this.finish(run, "Generation stopped.", true);
        else
          void this.finish(
            run,
            event.error?.message ?? "The CLI run has ended. Send a new message to continue.",
          );
      }
    }
  }

  private emit(run: SessionRun, chunk: UIMessageChunk): void {
    appendReplayChunk(run.chunks, chunk);
    run.controller.enqueue(chunk);
    this.broadcast(run, chunk);
  }

  /**
   * Send a transient chunk to the browsers attached now. It is not replayed to
   * later attachments (they read the same state from the session snapshot) and
   * not written into the stored message.
   */
  private broadcast(run: SessionRun, chunk: UIMessageChunk): void {
    for (const listener of run.listeners) {
      try {
        listener(chunk);
      } catch (error) {
        // One broken browser stream must not starve the others or the run.
        log().error({ err: error, sessionId: run.record.id }, "Stream listener failed");
        run.listeners.delete(listener);
      }
    }
  }

  private checkpoint(run: SessionRun): void {
    if (run.timer || run.finished) return;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      void this.store.save(run.record).catch((error) => {
        log().error({ err: error, sessionId: run.record.id }, "Checkpoint failed");
        void this.finish(run, "Unable to save the session. Check available disk space.");
      });
    }, CHECKPOINT_INTERVAL_MS);
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
      if (this.closing || record.queuePaused || this.runs.has(id)) return;
      const input = record.queuedMessages?.[0];
      if (!input) return;
      try {
        await this.send(id, input, true);
      } catch (error) {
        if (error instanceof SessionConflictError && this.runs.has(id)) return;
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

  async send(id: string, input: SessionInput, queued = false): Promise<void> {
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
    const previous = this.runs.get(id);
    if (previous?.finished) await previous.done;
    if (this.runs.has(id))
      throw new SessionConflictError("The session is still running.", "SESSION_BUSY");
    if (record.messages.some((message) => message.id === input.id))
      throw new SessionConflictError(
        "This message has already been submitted. Refresh the session.",
      );
    const assistantId = randomUUID();
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({
      start(value) {
        controller = value;
      },
    });
    let resolveDone = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const run: SessionRun = {
      done,
      resolveDone,
      record,
      assistantId,
      chunks: [],
      listeners: new Set(),
      controller,
      writer: new UIChunkWriter((chunk) => this.emit(run, chunk)),
      // A live process reported its model once; a new one reports it again.
      metadata: { model: this.supervisor.get(id)?.resolvedModel ?? record.model },
      startedAt: Date.now(),
      consume: Promise.resolve(),
      finished: false,
    };
    this.runs.set(id, run);
    record.queuedMessages = record.queuedMessages?.filter((message) => message.id !== input.id);
    record.messages.push({
      id: input.id,
      role: "user",
      parts: [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        ...attachments.map(({ visible }) => ({
          type: "file" as const,
          mediaType: visible.mediaType,
          filename: visible.filename,
          url: visible.url,
        })),
      ],
    });
    record.state = "running";
    record.error = undefined;
    record.pendingInput = undefined;
    // This turn starts with the options changed during the last one.
    record.pendingOptions = undefined;
    if (record.title === UNTITLED_SESSION_TITLE)
      record.title =
        input.text.slice(0, TITLE_LENGTH) ||
        attachments[0]?.visible.filename ||
        UNTITLED_SESSION_TITLE;
    run.consume = (async () => {
      for await (const message of readUIMessageStream<SessionMessage>({
        stream,
        onError: (error) => log().error({ err: error, sessionId: id }, "Message stream error"),
      })) {
        // Each message the stream yields is already a copy of its own.
        const index = record.messages.findIndex((item) => item.id === assistantId);
        if (index < 0) record.messages.push(message);
        else record.messages[index] = message;
        this.checkpoint(run);
      }
    })();
    this.emit(run, { type: "start", messageId: assistantId });
    void this.launch(
      run,
      input,
      attachments.map(({ file }) => file),
    );
  }

  /**
   * Where the agent works: a literature project is a real project directory it
   * shares with other sessions; a session without one keeps a private draft.
   */
  async workingDirectory(session: string | SessionRecord): Promise<string> {
    const record = typeof session === "string" ? this.store.get(session) : session;
    const project = record.projectId ? await this.project(record) : undefined;
    if (!project) return this.store.workspace(record);
    if (!project.path)
      throw new Error("Library project directory is missing. Update the library service.");
    return project.path;
  }

  /**
   * The session's project as the library knows it now. The library renames and
   * archives projects on its own; the session follows. A session that names its
   * project by name (as sessions did before projects had ids) moves to the id,
   * and one whose project is gone continues in its own workspace, like a session
   * started without a project.
   */
  private async project(record: SessionRecord): Promise<LiteratureProject | undefined> {
    const reference = record.projectId;
    if (!reference) return undefined;
    const project = await this.library.project(reference);
    if (!project) {
      log().info({ sessionId: record.id, projectId: reference }, "Project gone; session detached");
      record.projectId = undefined;
      await this.store.save(record);
      return undefined;
    }
    if (project.id !== reference) {
      record.projectId = project.id;
      await this.store.save(record);
    }
    return project;
  }

  /**
   * Bring every session up to the library's projects at once: sessions that
   * name a project by name move to its id, those whose project is gone are
   * detached. The server runs this once the library answers; `project` does
   * the same for one session whenever it is used. Returns how many changed.
   */
  async reconcileProjects(): Promise<number> {
    const projects = await this.library.projects();
    const ids = new Set(projects.map((project) => project.id));
    const byName = new Map(projects.map((project) => [project.name, project.id]));
    let changed = 0;
    for (const { id } of this.store.list()) {
      const record = this.store.get(id);
      if (!record.projectId || ids.has(record.projectId)) continue;
      record.projectId = byName.get(record.projectId);
      await this.store.save(record);
      changed += 1;
    }
    return changed;
  }

  /**
   * Passages for the question from the session's workspace or chosen papers.
   * A session with neither (the default workspace) gets none: the whole
   * library is not its scope.
   */
  private async libraryContext(
    record: SessionRecord,
    question: string,
  ): Promise<LibraryContext | undefined> {
    if (!record.projectId && record.paperIds.length === 0) return undefined;
    return this.library.context({
      query: question.slice(0, CONTEXT_QUERY_LENGTH),
      paperIds: record.paperIds,
      projectId: record.projectId,
    });
  }

  private async launch(
    run: SessionRun,
    input: SessionInput,
    attachments: UploadedFile[],
  ): Promise<void> {
    const { record } = run;
    const id = record.id;
    try {
      await this.store.save(record);
      const context = await this.libraryContext(record, input.text);
      if (run.finished) return;
      if (context) {
        this.emit(run, { type: "data-citations", id: "citations", data: context.citations });
        if (context.truncated)
          this.emit(run, {
            type: "data-notice",
            id: "context",
            data: {
              level: "info",
              text: "Library excerpts were truncated to fit the context limit.",
            },
          });
      }
      const skill = await requestedSkill(input.text, this.skillsDir);
      const text = agentPrompt(input.text, skill, context);
      const projectPath = await this.workingDirectory(record);
      // Stopped while the prompt was being prepared: nothing to send.
      if (run.finished) return;
      const process = await this.supervisor.send({
        sessionId: id,
        nativeSessionId: record.nativeSessionId,
        projectPath,
        message: { text, attachments },
        permissionMode: record.permissionMode ?? "default",
        settings: {
          providerName: record.provider,
          model: record.model,
          ...(record.thinking ? { thinking: thinkingModeToConfig(record.thinking) } : {}),
          ...(record.effort ? { effort: record.effort } : {}),
        },
      });
      // Stopped while the process was starting: stop that one, not a later run's.
      if (run.finished) this.supervisor.release(id, "Application run already stopped", process);
    } catch (error) {
      await this.finish(run, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Where a user turn sits: its index among the messages, and how many user
   * turns follow it. Only an idle, writable session can be cut.
   */
  private async turnAt(record: SessionRecord, messageId: string) {
    const previous = this.runs.get(record.id);
    if (previous?.finished) await previous.done;
    if (record.readOnly)
      throw new SessionConflictError("Imported historical sessions cannot be edited or forked.");
    if (this.runs.has(record.id) || this.changingOptions.has(record.id))
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
   * Remove the user turn `messageId` and everything after it, so an edited
   * version can be sent in its place. The agent resumes a fork of its native
   * session that ends before that turn; file changes are not undone.
   */
  async rewind(id: string, messageId: string): Promise<StoredSession> {
    const record = this.store.get(id);
    const { index, later } = await this.turnAt(record, messageId);
    const keepsAny = record.messages.slice(0, index).some((message) => message.role === "user");
    // The next turn resumes the fork; the supervisor sees the live process
    // holds a different conversation and replaces it.
    const nativeSessionId = await this.forkNative(record, later + 1, keepsAny);
    record.messages = record.messages.slice(0, index);
    record.nativeSessionId = nativeSessionId;
    record.contextUsage = undefined;
    record.error = undefined;
    record.state = "idle";
    await this.store.save(record);
    return this.detail(id);
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
    const run = this.runs.get(id);
    if (!run) return null;
    let dispose = () => {};
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        const close = () => {
          dispose();
          controller.close();
        };
        const listener = (chunk: UIMessageChunk | null) => {
          if (chunk) controller.enqueue(chunk);
          else close();
        };
        dispose = () => {
          run.listeners.delete(listener);
          signal.removeEventListener("abort", close);
        };
        if (signal.aborted) {
          controller.close();
          return;
        }
        for (const chunk of run.chunks) controller.enqueue(chunk);
        if (run.finished) controller.close();
        else {
          // The state may have changed after the snapshot this browser holds
          // (a question asked in between); state chunks are not replayed.
          const { state, pendingInput } = run.record;
          controller.enqueue({
            type: "data-session-state",
            data: { state, pendingInput },
            transient: true,
          });
          run.listeners.add(listener);
          signal.addEventListener("abort", close, { once: true });
        }
      },
      cancel() {
        dispose();
      },
    });
  }

  private async finish(run: SessionRun, error?: string, interrupted = false): Promise<void> {
    if (run.finished) return run.done;
    run.finished = true;
    clearTimeout(run.timer);
    run.record.state = interrupted || run.interrupted ? "interrupted" : error ? "error" : "idle";
    if (run.record.state !== "idle") run.record.queuePaused = true;
    run.record.error = error;
    run.record.pendingInput = undefined;
    run.writer.close();
    run.metadata.durationMs = Date.now() - run.startedAt;
    run.metadata.finishedAt = new Date().toISOString();
    const metadata = Object.fromEntries(
      Object.entries(run.metadata).filter(([, value]) => value !== undefined),
    ) as SessionMessageMetadata;
    if (Object.keys(metadata).length) {
      this.emit(run, { type: "message-metadata", messageMetadata: metadata });
    }
    if (error) {
      this.emit(run, { type: "data-notice", id: "error", data: { level: "error", text: error } });
    }
    this.emit(run, { type: "finish", finishReason: error ? "error" : "stop" });
    run.controller.close();
    for (const listener of [...run.listeners]) listener(null);
    run.listeners.clear();
    try {
      await run.consume;
      await this.store.save(run.record);
    } catch (saveError) {
      run.record.state = "error";
      run.record.error = "Unable to save this turn. Check available disk space and try again.";
      log().error({ err: saveError, sessionId: run.record.id }, "Final save failed");
    } finally {
      if (this.runs.get(run.record.id) === run) this.runs.delete(run.record.id);
      run.resolveDone();
    }
    if (run.record.state === "idle") void this.drain(run.record.id);
  }

  async stop(id: string): Promise<void> {
    const record = this.store.get(id);
    record.queuePaused = true;
    await this.store.save(record);
    const run = this.runs.get(id);
    if (!run || run.finished) return;
    run.interrupted = true;
    const process = this.supervisor.get(id);
    // An idle process has not been handed this run's message yet: there is no
    // turn to interrupt, and the run's launch sees it finished and sends nothing.
    if (process && process.state.type !== "idle") {
      // Interrupt the turn and let it settle, so the worker stays for the next
      // message. One that cannot interrupt, or does not settle in time, is
      // terminated; the next message resumes its native session.
      const settled = await resolvesWithin(
        process.interrupt().then((supported) => {
          if (!supported) throw new Error("interrupt unsupported");
          return run.done;
        }),
        STOP_SETTLE_MS,
      );
      if (!settled) this.supervisor.release(id, "User interrupted application run");
    }
    await this.finish(run, "Generation stopped.", true);
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
    for (const run of this.runs.values())
      await this.finish(run, "The run was interrupted by service shutdown.", true);
    this.unsubscribe();
  }
}
