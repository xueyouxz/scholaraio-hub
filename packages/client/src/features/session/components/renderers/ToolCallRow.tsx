import { readToolOutput } from "@scholaraio-hub/shared";
import { type ReactNode, memo, useState } from "react";
import type { ToolPart } from "../../lib/parts";
import { rendererFor, toolLabel } from "./registry";
import type { ToolStatus, ToolView } from "./types";

export type { ToolPart };

/** Normalize an AI SDK dynamic-tool part into the provider-neutral view. */
export function toolView(part: ToolPart, streaming: boolean): ToolView {
  const running = part.state === "output-available" && part.preliminary === true;
  const result =
    part.state === "output-available"
      ? readToolOutput(part.output)
      : part.state === "output-error"
        ? readToolOutput(undefined, String(part.errorText))
        : undefined;
  let status: ToolStatus;
  if (part.state === "output-denied") status = "error";
  else if (result && !running) status = result.isError ? "error" : "complete";
  else status = streaming ? "pending" : "aborted";
  return {
    name: part.toolName,
    input: part.input,
    status,
    result,
    running,
    inputStreaming: part.state === "input-streaming",
  };
}

/** "Read app.ts" — how a call is named in a one-line mention. */
export function describeToolCall(part: ToolPart, streaming: boolean): string {
  const view = toolView(part, streaming);
  const renderer = rendererFor(view.name);
  return `${toolLabel(renderer, view)} ${renderer.summary(view)}`.trim();
}

/** A subagent's own timeline, shown inside the call that started it. */
export interface NestedWork {
  node: ReactNode;
  /** Tool calls the subagent made. */
  toolCount: number;
  /** The subagent's most recent tool call, described. */
  latest?: string;
}

interface RowProps {
  part: ToolPart;
  streaming: boolean;
  nested?: NestedWork;
  /** A pending decision about this call, asked right here on its row. */
  interaction?: ReactNode;
}

/**
 * Skip re-rendering a finished row when a streamed delta elsewhere in the turn
 * produces a new but equal part — an Edit diff or a long output is costly to
 * redraw on every token. Rows with nested work or a pending prompt receive
 * freshly built nodes each time and always re-render.
 */
export function sameToolCall(previous: RowProps, next: RowProps): boolean {
  if (previous.nested || next.nested || previous.interaction || next.interaction) return false;
  if (previous.streaming !== next.streaming) return false;
  if (previous.part === next.part) return true;
  const signature = (part: ToolPart) =>
    JSON.stringify([
      part.toolCallId,
      part.toolName,
      part.state,
      "preliminary" in part ? part.preliminary : undefined,
      part.input,
      "output" in part ? part.output : undefined,
      "errorText" in part ? part.errorText : undefined,
    ]);
  return signature(previous.part) === signature(next.part);
}

/**
 * One tool call on the assistant timeline, Claude Code style: tool name and a
 * short target in the header, the outcome in muted text once it finishes, a
 * preview while collapsed, and the renderer's detail when expanded.
 */
export const ToolCallRow = memo(function ToolCallRow({
  part,
  streaming,
  nested,
  interaction,
}: RowProps) {
  const view = toolView(part, streaming);
  const renderer = rendererFor(view.name);
  const [expanded, setExpanded] = useState(() => renderer.defaultExpanded?.(view) ?? false);
  const toolUses = nested?.toolCount
    ? `${nested.toolCount} tool ${nested.toolCount === 1 ? "use" : "uses"}`
    : undefined;
  const outcome =
    view.status === "pending" ? undefined : (renderer.resultSummary?.(view) ?? toolUses);
  // While a subagent works, its latest step is the useful preview.
  const preview = expanded ? null : view.status === "pending" && nested?.latest ? (
    <span className="tool-nested-latest">{nested.latest}</span>
  ) : view.result ? (
    renderer.preview?.(view)
  ) : null;

  return (
    <div
      className={`tool-row timeline-item ${expanded ? "expanded" : "collapsed"} status-${view.status}`}
    >
      <button
        type="button"
        className="tool-row-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {view.status === "pending" ? (
          <span className="tool-spinner" aria-label="Running">
            <Spinner />
          </span>
        ) : null}
        {view.status === "aborted" ? (
          <span className="tool-aborted-icon" aria-label="Interrupted">
            ⨯
          </span>
        ) : null}
        <span className="tool-name" title={view.name}>
          {toolLabel(renderer, view)}
        </span>
        <span className="tool-summary">{renderer.summary(view)}</span>
        {outcome ? (
          <span className={`tool-outcome${view.status === "error" ? " text-error" : ""}`}>
            {outcome}
          </span>
        ) : null}
        {view.status === "aborted" ? (
          <span className="tool-aborted-label">(interrupted)</span>
        ) : null}
        <span className="expand-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {interaction ? <div className="tool-row-interaction">{interaction}</div> : null}
      {preview && !interaction ? <div className="tool-row-preview">{preview}</div> : null}
      {expanded && !(interaction && renderer.askedInline) ? (
        <div className="tool-row-content">
          {nested ? <div className="task-nested-content">{nested.node}</div> : null}
          {renderer.body(view)}
          {view.status === "pending" && !view.result ? (
            <p className="tool-pending-message">{view.inputStreaming ? "Writing…" : "Running…"}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}, sameToolCall);

function Spinner() {
  return (
    <svg className="spinner" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="10"
        strokeLinecap="round"
      />
    </svg>
  );
}
