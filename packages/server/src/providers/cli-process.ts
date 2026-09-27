/**
 * A provider CLI the hub spawned (the Claude Code CLI, `codex app-server`):
 * its stderr, read so a full pipe never blocks it and kept to explain a
 * failure; whether it still runs; and a termination that escalates to SIGKILL.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { loggerFor } from "../logging/logger.js";

/** How much of a CLI's stderr is kept to explain its failure. */
const STDERR_TAIL_CHARS = 4096;
/** How long a terminating CLI gets before SIGKILL. */
const TERMINATE_GRACE_MS = 1500;

export interface CliSpawnOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  /** Run in its own process group, so terminating reaches what the CLI started. */
  group?: boolean;
  /** Each stderr chunk as it arrives, besides the kept tail. */
  onStderr?: (text: string) => void;
}

export class CliProcess {
  private tail = "";
  private terminating?: Promise<void>;
  /** Settles once the process has exited, or failed to start. */
  private readonly exit: Promise<void>;

  static spawn(command: string, args: string[], options: CliSpawnOptions): CliProcess {
    const group = Boolean(options.group) && process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: group,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return new CliProcess(child, group, options.onStderr);
  }

  private constructor(
    readonly child: ChildProcessByStdio<Writable, Readable, Readable>,
    private readonly group: boolean,
    onStderr?: (text: string) => void,
  ) {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      this.tail = (this.tail + text).slice(-STDERR_TAIL_CHARS);
      onStderr?.(text);
    });
    this.exit = new Promise((resolve) => {
      child.once("exit", () => resolve());
      // A spawn failure has no exit to wait for.
      child.once("error", () => {
        if (child.pid === undefined) resolve();
      });
    });
  }

  /** The last of what the CLI wrote to stderr, trimmed. */
  get stderrTail(): string {
    return this.tail.trim();
  }

  get hasExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  isAlive(): boolean {
    return Boolean(this.child.pid) && !this.hasExited && !this.child.killed;
  }

  /**
   * SIGTERM, then SIGKILL if the CLI outlives `graceMs`. Settles once it has
   * exited; safe to call more than once.
   */
  terminate(graceMs = TERMINATE_GRACE_MS): Promise<void> {
    if (this.terminating) return this.terminating;
    if (!this.child.pid || this.hasExited || !this.signal("SIGTERM")) {
      this.terminating = Promise.resolve();
      return this.terminating;
    }
    const timer = setTimeout(() => {
      if (!this.hasExited) this.signal("SIGKILL");
    }, graceMs);
    timer.unref();
    this.terminating = this.exit.finally(() => clearTimeout(timer));
    return this.terminating;
  }

  /** False when the signal could not be sent (the process is already gone). */
  private signal(signal: NodeJS.Signals): boolean {
    const pid = this.child.pid;
    if (!pid) return false;
    try {
      if (this.group) process.kill(-pid, signal);
      else this.child.kill(signal);
      return true;
    } catch (error) {
      loggerFor("cli-process").debug({ err: error, pid, signal }, "CLI signal not delivered");
      return false;
    }
  }
}
