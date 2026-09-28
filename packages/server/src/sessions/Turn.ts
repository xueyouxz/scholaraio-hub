/**
 * One assistant turn of a session, from the user's message to its single
 * ending: it turns the provider's events into UI chunks, keeps them for
 * browsers that attach later, and streams them to those attached now. The
 * conversation itself is the provider's to keep; the turn files what the Hub
 * adds to it (the prompt as the user wrote it, citations, notices, metadata)
 * in the session record, under the provider's id for the prompt.
 *
 * What starts a turn and what follows it (the process, the queue) is the
 * SessionService's; a turn only knows its own record and how to save it.
 */

import type {
  LibraryCitation,
  SessionMessage,
  SessionMessageMetadata,
  SessionNotice,
  SessionStatePush,
} from "@scholaraio-hub/shared";
import type { UIMessageChunk } from "ai";
import { loggerFor } from "../logging/logger.js";
import type { AgentEvent } from "../providers/events.js";
import type { PromptRecord, SessionRecord } from "./SessionStore.js";
import { UIChunkWriter, appendReplayChunk } from "./UIChunkWriter.js";
import { endTurn, recordPrompt, turnNotSaved } from "./session-record.js";
import { assemble } from "./transcript.js";

const log = () => loggerFor("session");

/** How often a running turn's state is written to disk, at most. */
const CHECKPOINT_INTERVAL_MS = 1000;

type Listener = (chunk: UIMessageChunk | null) => void;

export interface TurnHooks {
  /** Write the session record to disk. */
  save(record: SessionRecord): Promise<void>;
  /** The turn has ended and its record is saved; runs before `done` settles. */
  ended(turn: Turn): void;
}

export class Turn {
  /** The id of the assistant message this turn writes. */
  readonly assistantId: string;
  /** Settles once the turn has ended and its record was saved (or failed to be). */
  readonly done: Promise<void>;
  /** The user asked to stop: however the turn ends, it ends as interrupted. */
  interrupted = false;
  /**
   * The provider's id for this turn's prompt: the id the Hub sent it with,
   * until a provider that names prompts itself says otherwise.
   */
  promptId: string;

  private readonly chunks: UIMessageChunk[] = [];
  private readonly listeners = new Set<Listener>();
  /** Turns the provider's events into UI chunks. */
  private readonly writer = new UIChunkWriter((chunk) => this.emit(chunk));
  /** Model and usage for this turn, sent as message metadata when it ends. */
  private readonly metadata: SessionMessageMetadata;
  private readonly startedAt = Date.now();
  private citations: LibraryCitation[] | undefined;
  private readonly notices: SessionNotice[] = [];
  private resolveDone = () => {};
  private timer?: ReturnType<typeof setTimeout>;
  private ended = false;

  constructor(
    /** The session's id; a new session's placeholder until its provider names it. */
    public key: string,
    readonly record: SessionRecord,
    /** What the user sent, and the id it goes to the provider with. */
    readonly prompt: PromptRecord & { promptId: string },
    /** The model the session's live process already reported, if it has one. */
    model: string | undefined,
    readonly hooks: TurnHooks,
  ) {
    this.assistantId = prompt.replyId;
    this.promptId = prompt.promptId;
    this.metadata = { model };
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.file();
    this.emit({ type: "start", messageId: this.assistantId });
  }

  get finished(): boolean {
    return this.ended;
  }

  /** One provider event of this turn; `turn.completed` ends it. */
  accept(event: AgentEvent): void {
    if (event.type === "prompt.recorded") {
      const filedAs = this.promptId;
      this.promptId = event.promptId;
      this.file(filedAs);
      this.checkpoint();
      return;
    }
    if (event.type === "model.resolved") this.metadata.model = event.model;
    if (event.type === "turn.completed") {
      if (event.usage) this.metadata.usage = event.usage;
      if (event.contextWindow) this.metadata.contextWindow = event.contextWindow;
    }
    this.writer.write(event);
    if (event.type === "turn.completed") void this.finish(event.error);
  }

  /** A chunk that belongs to the answer, kept and replayed. */
  emit(chunk: UIMessageChunk): void {
    appendReplayChunk(this.chunks, chunk);
    this.broadcast(chunk);
  }

  /** The library passages the prompt carried, shown with the answer and kept with the prompt. */
  cite(citations: LibraryCitation[]): void {
    this.citations = citations;
    this.emit({ type: "data-citations", id: "citations", data: citations });
  }

  /**
   * Something the Hub tells the user about this answer (not the provider):
   * shown with it now and kept with the prompt, since the transcript has no
   * record of it.
   */
  notice(id: string, notice: SessionNotice): void {
    this.notices.push(notice);
    this.emit({ type: "data-notice", id, data: notice });
  }

  /**
   * Tell the browsers attached now about the record's state (a question asked,
   * then answered). Not replayed: later attachments read it from the snapshot.
   */
  showState(): void {
    this.broadcast({ type: "data-session-state", data: this.state(), transient: true });
    this.checkpoint();
  }

  /** The turn so far, then live until it ends or `signal` aborts. */
  attach(signal: AbortSignal): ReadableStream<UIMessageChunk> {
    let dispose = () => {};
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const close = () => {
          dispose();
          controller.close();
        };
        const listener: Listener = (chunk) => {
          if (chunk) controller.enqueue(chunk);
          else close();
        };
        dispose = () => {
          this.listeners.delete(listener);
          signal.removeEventListener("abort", close);
        };
        if (signal.aborted) {
          controller.close();
          return;
        }
        for (const chunk of this.chunks) controller.enqueue(chunk);
        if (this.ended) controller.close();
        else {
          // The state may have changed after the snapshot this browser holds
          // (a question asked in between); state chunks are not replayed.
          controller.enqueue({ type: "data-session-state", data: this.state(), transient: true });
          this.listeners.add(listener);
          signal.addEventListener("abort", close, { once: true });
        }
      },
      cancel() {
        dispose();
      },
    });
  }

  /**
   * End the turn once: record how it ended, send the closing chunks, detach
   * every browser, and save. Later calls return the same `done`.
   */
  async finish(error?: string, interrupted = false): Promise<void> {
    if (this.ended) return this.done;
    this.ended = true;
    clearTimeout(this.timer);
    const { record } = this;
    endTurn(record, { error, interrupted: interrupted || this.interrupted });
    this.writer.close();
    this.metadata.durationMs = Date.now() - this.startedAt;
    this.metadata.finishedAt = new Date().toISOString();
    const metadata = Object.fromEntries(
      Object.entries(this.metadata).filter(([, value]) => value !== undefined),
    ) as SessionMessageMetadata;
    if (Object.keys(metadata).length) {
      this.emit({ type: "message-metadata", messageMetadata: metadata });
    }
    if (error) this.notice("error", { level: "error", text: error });
    this.emit({ type: "finish", finishReason: error ? "error" : "stop" });
    for (const listener of [...this.listeners]) listener(null);
    this.listeners.clear();
    try {
      // A reply cut short may be missing from the provider's transcript; keep what it showed.
      const reply = record.state === "idle" ? undefined : (await assemble(this.chunks))?.parts;
      this.file(undefined, metadata, reply);
      await this.hooks.save(record);
    } catch (saveError) {
      turnNotSaved(record);
      log().error({ err: saveError, sessionKey: this.key }, "Final save failed");
    } finally {
      this.hooks.ended(this);
      this.resolveDone();
    }
  }

  private state(): SessionStatePush {
    const { state, pendingInput } = this.record;
    return { state, pendingInput };
  }

  /** File the prompt, and what the Hub added to its answer so far, in the record. */
  private file(
    filedAs?: string,
    metadata?: SessionMessageMetadata,
    reply?: SessionMessage["parts"],
  ): void {
    const { promptId: _, ...prompt } = this.prompt;
    recordPrompt(
      this.record,
      this.promptId,
      {
        ...prompt,
        ...(this.citations ? { citations: this.citations } : {}),
        ...(this.notices.length ? { notices: [...this.notices] } : {}),
        ...(metadata ? { metadata } : {}),
        ...(reply?.length ? { reply } : {}),
      },
      filedAs,
    );
  }

  private broadcast(chunk: UIMessageChunk): void {
    for (const listener of this.listeners) {
      try {
        listener(chunk);
      } catch (error) {
        // One broken browser stream must not starve the others or the turn.
        log().error({ err: error, sessionKey: this.key }, "Stream listener failed");
        this.listeners.delete(listener);
      }
    }
  }

  /** Save the record soon, at most once per interval; a failed save ends the turn. */
  private checkpoint(): void {
    if (this.timer || this.ended) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.hooks.save(this.record).catch((error) => {
        log().error({ err: error, sessionKey: this.key }, "Checkpoint failed");
        void this.finish("Unable to save the session. Check available disk space.");
      });
    }, CHECKPOINT_INTERVAL_MS);
  }
}
