import {
  askUserQuestionRenderer,
  bashRenderer,
  editRenderer,
  exitPlanModeRenderer,
  fallbackRenderer,
  globRenderer,
  grepRenderer,
  readRenderer,
  taskRenderer,
  todoWriteRenderer,
  webFetchRenderer,
  webSearchRenderer,
  writeRenderer,
} from "./tools";
import type { FileChange, ToolRenderer, ToolView } from "./types";

const RENDERERS = new Map<string, ToolRenderer>(
  [
    bashRenderer,
    readRenderer,
    writeRenderer,
    editRenderer,
    grepRenderer,
    globRenderer,
    todoWriteRenderer,
    webSearchRenderer,
    webFetchRenderer,
    taskRenderer,
    askUserQuestionRenderer,
    exitPlanModeRenderer,
  ].map((renderer) => [renderer.tool, renderer]),
);

/**
 * The server already canonicalizes provider tool names, so this only covers
 * Claude Code's own synonyms.
 */
const ALIASES: Record<string, string> = {
  MultiEdit: "Edit",
  Agent: "Task", // Agent SDK 0.2.76 renamed Task to Agent
};

/** The row title: the renderer's verb for this status, else the raw tool name. */
export function toolLabel(renderer: ToolRenderer, view: ToolView): string {
  if (!renderer.verb) return view.name;
  return view.status === "pending" ? renderer.verb.pending : renderer.verb.done;
}

/** The name a call is filed under here: Claude Code's synonyms resolved. */
export function canonicalToolName(toolName: string): string {
  return ALIASES[toolName] ?? toolName;
}

export function rendererFor(toolName: string): ToolRenderer {
  return RENDERERS.get(canonicalToolName(toolName)) ?? fallbackRenderer;
}

/** One-line description of a call, for places that only show a label. */
export function toolSummary(toolName: string, input: unknown): string {
  return rendererFor(toolName).summary({
    name: toolName,
    input,
    status: "pending",
    partial: false,
    inputStreaming: false,
  });
}

/** The files a call changed, once it has finished; none for tools that change no files. */
export function fileChanges(view: ToolView): FileChange[] {
  if (view.status !== "complete") return [];
  return rendererFor(view.name).fileChanges?.(view) ?? [];
}
