import { Suspense, lazy } from "react";
import { editPatch, patchStats } from "./patch";
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
  resultSummary: (view) => {
    if (!view.result) return undefined;
    if (view.result.isError) return truncate(contentText(view.result), 80);
    const patch = editPatch(view.input, view.result.detail);
    if (!patch) return undefined;
    const { added, removed } = patchStats(patch);
    return `+${added} −${removed}`;
  },
  defaultExpanded: (view) => !view.result?.isError,
  body: (view) => (
    <>
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

export function rendererFor(toolName: string): ToolRenderer {
  return RENDERERS.get(ALIASES[toolName] ?? toolName) ?? fallbackRenderer;
}

/** One-line description of a call, for places that only show a label. */
export function toolSummary(toolName: string, input: unknown): string {
  return rendererFor(toolName).summary({
    name: toolName,
    input,
    status: "pending",
    running: false,
    inputStreaming: false,
  });
}
