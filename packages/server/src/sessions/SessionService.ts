import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  CreateSessionSchema,
  LibraryContext,
  LiteratureProject,
  NewSessionDefaults,
  ProviderName,
  ProviderUsageLimits,
  SessionInput,
  SessionMessage,
  SessionMessageMetadata,
  StoredSession,
  UploadedFile,
} from "@scholaraio-hub/shared";
import {
  DEFAULT_PROVIDER,
  UNTITLED_SESSION_TITLE,
  thinkingModeToConfig,
} from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import type { z } from "zod";
import { type LibraryClient, LibraryRequestError } from "../lib/LibraryClient.js";
import { loggerFor } from "../logging/logger.js";
import type { AgentProvider } from "../providers/types.js";
import type { PermissionMode } from "../providers/types.js";
import { researchSlashCommands } from "../skills/scholaraioSkills.js";
import { Supervisor } from "../supervisor/Supervisor.js";
import type { ProcessEvent } from "../supervisor/types.js";
import { resolvesWithin } from "../utils/timeout.js";
import { SessionAttachments } from "./SessionAttachments.js";
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
  /** Agent provider used when a session does not name one. */
  provider: AgentProvider;
  idleTimeoutMs?: number;
  /** Research skills, offered as commands and expanded into prompts. */
  skillsDir?: string;
  /** Usage-limit windows providers report in passing, for the usage display. */
  onUsageLimits?: (limits: ProviderUsageLimits) => void;
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
  /** The provider processes serving these sessions, one per session. */
  private readonly supervisor: Supervisor;
  private readonly skillsDir?: string;
  private readonly onUsageLimits?: (limits: ProviderUsageLimits) => void;
  readonly attachments: SessionAttachments;
  constructor(
    readonly store: SessionStore,
    private library: LibraryClient,
    options: SessionServiceOptions,
  ) {
    this.attachments = new SessionAttachments(store);
    this.skillsDir = options.skillsDir;
    this.onUsageLimits = options.onUsageLimits;
    this.supervisor = new Supervisor({
      provider: options.provider,
      idleTimeoutMs: options.idleTimeoutMs,
      onEvent: (id, event) => this.onEvent(id, event),
    });
  }

  /**
   * Create a session. The client may leave the provider and model to the
   * new-session defaults; draft uploads named in the request move into it.
   */
  async create(input: NewSessionInput, defaults?: NewSessionDefaults): Promise<StoredSession> {
    const provider = input.provider ?? defaults?.provider ?? DEFAULT_PROVIDER;
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
  async commands(id?: string, provider: ProviderName = DEFAULT_PROVIDER) {
    const record = id ? this.store.get(id) : undefined;
    const workspace = record
      ? await this.workingDirectory(record)
      : path.join(this.store.dataDir, "draft-workspace");
    await mkdir(workspace, { recursive: true });
    const agent = this.supervisor.providerFor(record?.provider ?? provider);
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

  /** Refuse papers or a project the library does not have. */
  private async validateScope(input: { projectId?: string; paperIds: string[] }): Promise<void> {
    if (!input.projectId && input.paperIds.length === 0) return;
    const { projectId, paperIds } = input;
    try {
      await this.library.json("/scope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, paperIds }),
      });
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
    const models = await this.supervisor.providerFor(provider).getAvailableModels();
    if (models.length === 0) return;
    const modelId = Object.hasOwn(options, "model") ? options.model : current.model;
    const model = modelId
      ? models.find((candidate) => candidate.id === modelId)
      : models.find((candidate) => candidate.isDefault);
    if (!model) return;
    if (!model.efforts?.some((option) => option.id === effort))
      throw new SessionInputError(`${model.name} 不支持推理强度 ${effort}`);
  }

  async updateOptions(
    id: string,
    input: Pick<StoredSession, "model" | "permissionMode" | "thinking" | "effort">,
  ) {
    const record = this.store.get(id);
    const previous = this.runs.get(id);
    if (previous?.finished) await previous.done;
    if (record.readOnly || this.changingOptions.has(id))
      throw new SessionConflictError("请稍后再调整会话设置。");
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
    if (event.type === "agent" && event.event.type === "rate-limit")
      this.onUsageLimits?.(event.event.limits);
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
        if (run.interrupted) void this.finish(run, "已停止生成。", true);
        else void this.finish(run, event.error?.message ?? "CLI 运行已结束，可发送新消息继续。");
      }
    }
  }

  private emit(run: SessionRun, chunk: UIMessageChunk): void {
    appendReplayChunk(run.chunks, chunk);
    run.controller.enqueue(chunk);
    for (const listener of run.listeners) listener(chunk);
  }

  /**
   * Send a transient chunk to the browsers attached now. It is not replayed to
   * later attachments (they read the same state from the session snapshot) and
   * not written into the stored message.
   */
  private broadcast(run: SessionRun, chunk: UIMessageChunk): void {
    for (const listener of run.listeners) listener(chunk);
  }

  private checkpoint(run: SessionRun): void {
    if (run.timer || run.finished) return;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      void this.store.save(run.record).catch((error) => {
        log().error({ err: error, sessionId: run.record.id }, "Checkpoint failed");
        void this.finish(run, "无法保存会话，请检查磁盘空间。");
      });
    }, CHECKPOINT_INTERVAL_MS);
  }

  async enqueue(id: string, input: SessionInput) {
    await Promise.all(
      input.attachmentIds.map((attachmentId) => this.attachments.resolve(id, attachmentId)),
    );
    const record = this.store.get(id);
    if (record.readOnly || this.closing) throw new SessionConflictError("当前会话无法排队");
    record.queuedMessages ??= [];
    const queue = record.queuedMessages;
    if (
      record.messages.some((message) => message.id === input.id) ||
      queue.some((message) => message.id === input.id)
    )
      return this.detail(id);
    if (queue.length >= MAX_QUEUED_MESSAGES)
      throw new SessionConflictError(`最多排队 ${MAX_QUEUED_MESSAGES} 条消息`);
    queue.push(input);
    await this.store.save(record);
    void this.drain(id);
    return this.detail(id);
  }

  async editQueue(id: string, action: "resume" | "remove", messageId?: string) {
    const record = this.store.get(id);
    if (record.readOnly) throw new SessionConflictError("历史会话只读");
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
      throw new SessionConflictError("正在保存会话设置，请稍后发送。");
    const record = this.store.get(id);
    if (record.readOnly || this.closing) throw new SessionConflictError("当前会话不能发送消息。");
    if (
      queued &&
      (record.queuePaused || !record.queuedMessages?.some((message) => message.id === input.id))
    )
      return;
    const previous = this.runs.get(id);
    if (previous?.finished) await previous.done;
    if (this.runs.has(id)) throw new SessionConflictError("当前会话仍在运行。");
    if (record.messages.some((message) => message.id === input.id))
      throw new SessionConflictError("此消息已提交，请刷新会话。");
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
        const index = record.messages.findIndex((item) => item.id === assistantId);
        const snapshot = structuredClone(message);
        if (index < 0) record.messages.push(snapshot);
        else record.messages[index] = snapshot;
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
    if (!record.projectId) return this.store.workspace(record);
    const project = await this.library.json<LiteratureProject>(
      `/projects/${encodeURIComponent(record.projectId)}`,
    );
    if (!project.path) throw new Error("文献项目缺少目录信息，请更新文献服务。");
    return project.path;
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
    return this.library.json<LibraryContext>("/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: question.slice(0, CONTEXT_QUERY_LENGTH),
        paperIds: record.paperIds,
        projectId: record.projectId,
      }),
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
            data: { level: "info", text: "已按上下文长度截取文献片段。" },
          });
      }
      const skill = await requestedSkill(input.text, this.skillsDir);
      const text = agentPrompt(input.text, skill, context);
      await this.supervisor.send({
        sessionId: id,
        nativeSessionId: record.nativeSessionId,
        projectPath: await this.workingDirectory(record),
        message: { text, attachments },
        permissionMode: record.permissionMode ?? "default",
        settings: {
          providerName: record.provider,
          model: record.model,
          ...(record.thinking ? { thinking: thinkingModeToConfig(record.thinking) } : {}),
          ...(record.effort ? { effort: record.effort } : {}),
        },
      });
      if (run.finished) this.supervisor.release(id, "Application run already stopped");
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
    if (record.readOnly) throw new SessionConflictError("导入的历史会话不能编辑或分叉。");
    if (this.runs.has(record.id) || this.changingOptions.has(record.id))
      throw new SessionConflictError("当前会话仍在运行，请结束后再试。");
    const index = record.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    if (index < 0) throw new SessionConflictError("找不到这条消息，请刷新会话。");
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
    const provider = this.supervisor.providerFor(record.provider);
    if (!provider.forkSession) throw new SessionConflictError("该 AI 工具不支持分叉会话。");
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
    if (!through) throw new SessionConflictError("会话还没有内容，无需分叉。");
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

  stream(id: string, signal: AbortSignal): ReadableStream<UIMessageChunk> | null {
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
      run.record.error = "本轮消息未能保存，请检查磁盘空间后重试。";
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
    if (process) {
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
    await this.finish(run, "已停止生成。", true);
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
    for (const run of this.runs.values()) await this.finish(run, "服务关闭中断了运行。", true);
    this.supervisor.close();
    await this.store.flush();
  }
}
