/**
 * One assistant turn of a session, from the user's message to its single
 * ending: it turns the provider's events into UI chunks, keeps them for
 * browsers that attach later, streams them to those attached now, writes the
 * growing message into the session record, and saves that record as it goes.
 *
 * What starts a turn and what follows it (the process, the queue) is the
 * SessionService's; a turn only knows its own record and how to save it.
 */

import type { SessionMessage, SessionMessageMetadata } from "@scholaraio-hub/shared";
import { type UIMessageChunk, readUIMessageStream } from "ai";
import { loggerFor } from "../logging/logger.js";
import type { AgentEvent } from "../providers/events.js";
import type { SessionRecord } from "./SessionStore.js";
import { UIChunkWriter, appendReplayChunk } from "./UIChunkWriter.js";

const log = () => loggerFor("session");

/** How often a running turn's progress is written to disk, at most. */
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

  private readonly chunks: UIMessageChunk[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly controller: ReadableStreamDefaultController<UIMessageChunk>;
  /** Turns the provider's events into UI chunks. */
  private readonly writer = new UIChunkWriter((chunk) => this.emit(chunk));
  /** Model and usage for this turn, sent as message metadata when it ends. */
  private readonly metadata: SessionMessageMetadata;
  private readonly startedAt = Date.now();
  /** Writes each state of the assistant message into the record. */
  private readonly consume: Promise<void>;
  private resolveDone = () => {};
  private timer?: ReturnType<typeof setTimeout>;
  private ended = false;

  constructor(
    readonly record: SessionRecord,
    assistantId: string,
    /** The model the session's live process already reported, if it has one. */
    model: string | undefined,
    private readonly hooks: TurnHooks,
  ) {
    this.assistantId = assistantId;
    this.metadata = { model };
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({
      start(value) {
        controller = value;
      },
    });
    this.controller = controller;
    this.consume = this.writeMessages(stream);
    this.emit({ type: "start", messageId: assistantId });
  }

  get finished(): boolean {
    return this.ended;
  }

  /** One provider event of this turn; `turn.completed` ends it. */
  accept(event: AgentEvent): void {
    if (event.type === "model.resolved") this.metadata.model = event.model;
    if (event.type === "turn.completed") {
      if (event.usage) this.metadata.usage = event.usage;
      if (event.contextWindow) this.metadata.contextWindow = event.contextWindow;
    }
    this.writer.write(event);
    if (event.type === "turn.completed") void this.finish(event.error);
  }

  /** A chunk that belongs to the answer (citations, notices), kept and replayed. */
  emit(chunk: UIMessageChunk): void {
    appendReplayChunk(this.chunks, chunk);
    this.controller.enqueue(chunk);
    this.broadcast(chunk);
  }

  /**
   * Tell the browsers attached now about the record's state (a question asked,
   * then answered). Not replayed: later attachments read it from the snapshot.
   */
  showState(): void {
    const { state, pendingInput } = this.record;
    this.broadcast({ type: "data-session-state", data: { state, pendingInput }, transient: true });
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
          const { state, pendingInput } = this.record;
          controller.enqueue({
            type: "data-session-state",
            data: { state, pendingInput },
            transient: true,
          });
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
    record.state = interrupted || this.interrupted ? "interrupted" : error ? "error" : "idle";
    if (record.state !== "idle") record.queuePaused = true;
    record.error = error;
    record.pendingInput = undefined;
    this.writer.close();
    this.metadata.durationMs = Date.now() - this.startedAt;
    this.metadata.finishedAt = new Date().toISOString();
    const metadata = Object.fromEntries(
      Object.entries(this.metadata).filter(([, value]) => value !== undefined),
    ) as SessionMessageMetadata;
    if (Object.keys(metadata).length) {
      this.emit({ type: "message-metadata", messageMetadata: metadata });
    }
    if (error) {
      this.emit({ type: "data-notice", id: "error", data: { level: "error", text: error } });
    }
    this.emit({ type: "finish", finishReason: error ? "error" : "stop" });
    this.controller.close();
    for (const listener of [...this.listeners]) listener(null);
    this.listeners.clear();
    try {
      await this.consume;
      await this.hooks.save(record);
    } catch (saveError) {
      record.state = "error";
      record.error = "Unable to save this turn. Check available disk space and try again.";
      log().error({ err: saveError, sessionId: record.id }, "Final save failed");
    } finally {
      this.hooks.ended(this);
      this.resolveDone();
    }
  }

  /** Each state of the assistant message replaces the last one in the record. */
  private async writeMessages(stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const { record, assistantId } = this;
    for await (const message of readUIMessageStream<SessionMessage>({
      stream,
      onError: (error) => log().error({ err: error, sessionId: record.id }, "Message stream error"),
    })) {
      // Each message the stream yields is already a copy of its own.
      const index = record.messages.findIndex((item) => item.id === assistantId);
      if (index < 0) record.messages.push(message);
      else record.messages[index] = message;
      this.checkpoint();
    }
  }

  private broadcast(chunk: UIMessageChunk): void {
    for (const listener of this.listeners) {
      try {
        listener(chunk);
      } catch (error) {
        // One broken browser stream must not starve the others or the turn.
        log().error({ err: error, sessionId: this.record.id }, "Stream listener failed");
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
        log().error({ err: error, sessionId: this.record.id }, "Checkpoint failed");
        void this.finish("Unable to save the session. Check available disk space.");
      });
    }, CHECKPOINT_INTERVAL_MS);
  }
}
