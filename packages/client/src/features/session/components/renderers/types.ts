import type { ToolOutput } from "@scholaraio-hub/shared";
import type { ReactNode } from "react";

/**
 * pending  — the call is running (or its arguments are still streaming)
 * complete — a result arrived
 * error    — the result is a failure, or the call was denied
 * aborted  — the turn ended without a result
 */
export type ToolStatus = "pending" | "complete" | "error" | "aborted";

/**
 * Everything a renderer may look at for one tool call, the same for every
 * provider: the server has already canonicalized the tool name and input and
 * put structured result data (Claude Code's `tool_use_result` shape) in
 * `result.detail`.
 */
export interface ToolView {
  name: string;
  input: unknown;
  status: ToolStatus;
  /** Present once the tool has produced output, including partial output. */
  result?: ToolOutput;
  /** `result` is partial output of a still-running tool. */
  running: boolean;
  /** The call's arguments are still being written by the agent. */
  inputStreaming: boolean;
}

/**
 * How one canonical tool is presented. Mirrors the Claude Code layout: a
 * one-line header (`Read notes.md`), a muted result line once it finishes
 * (`42 lines`), an optional preview while collapsed, and a detail body.
 */
export interface ToolRenderer {
  tool: string;
  /**
   * What the call does, in the present tense while it runs and past tense once
   * it is done ("Reading" → "Read"). Shown instead of the raw tool name.
   */
  verb?: { pending: string; done: string };
  /** Header text after the tool name; keep it short. */
  summary(view: ToolView): string;
  /** One-line outcome shown after completion, e.g. "3 files". */
  resultSummary?(view: ToolView): string | undefined;
  /** Shown under the header while collapsed (e.g. the tail of a command's output). */
  preview?(view: ToolView): ReactNode;
  /** Expanded content. */
  body(view: ToolView): ReactNode;
  /**
   * The pending prompt for this tool already shows its input (questions, a
   * plan), so hide the body while it is being asked.
   */
  askedInline?: boolean;
  /** Start expanded (e.g. edits and plans, which are the point of the call). */
  defaultExpanded?(view: ToolView): boolean;
}

/** Read a string field from loosely typed tool input or detail. */
export function field(value: unknown, key: string): string {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return typeof data[key] === "string" ? (data[key] as string) : "";
}

/** Read a number field from loosely typed tool input or detail. */
export function numberField(value: unknown, key: string): number | undefined {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return typeof data[key] === "number" ? (data[key] as number) : undefined;
}

export function contentText(result: ToolOutput | undefined): string {
  if (!result) return "";
  return typeof result.content === "string"
    ? result.content
    : JSON.stringify(result.content, null, 2);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
