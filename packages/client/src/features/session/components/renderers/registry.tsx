import { Suspense, lazy } from "react";
import { FilePath } from "./blocks";
import { fileChanges, totalStats } from "./fileChanges";
import {
  askUserQuestionRenderer,
  bashRenderer,
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
import { type ToolRenderer, type ToolView, contentText, field, fileName, truncate } from "./types";

const EditDiff = lazy(() => import("./EditDiff"));

const editRenderer: ToolRenderer = {
  tool: "Edit",
  verb: { pending: "Editing", done: "Edited" },
  summary: (view) => {
    const path = field(view.input, "file_path");
    if (path) return fileName(path);
    const changes = (view.input as { changes?: unknown } | undefined)?.changes;
    return Array.isArray(changes) ? `${changes.length} files` : "…";
  },
  resultSummary: (view) =>
    view.result?.isError ? truncate(contentText(view.result), 80) : undefined,
  diffStats: (view) => totalStats(fileChanges(view)),
  body: (view) => (
    <>
      <FilePath path={field(view.input, "file_path")} />
      <Suspense fallback={<span className="tool-pending-message">加载差异…</span>}>
        <EditDiff input={view.input} detail={view.result?.detail} />
      </Suspense>
      {view.result?.isError ? (
        <p className="edit-error-message text-error">{contentText(view.result)}</p>
      ) : null}
    </>
  ),
};

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
