import { Bot, Clock, Hash, Wrench } from "lucide-react";
import type { TaskInput, TaskResult, ToolRenderer } from "./types";

const MAX_PROMPT_LENGTH = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function TaskUse({ input }: { input: TaskInput }) {
  return (
    <div className="task-tool-use space-y-1">
      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
        <Bot className="w-3.5 h-3.5" />
        <span className="font-medium">{input.subagent_type ?? "agent"}</span>
        {input.model ? <span className="opacity-60">· {input.model}</span> : null}
      </div>
      <div className="text-sm text-on-surface">{input.description}</div>
      {input.prompt ? (
        <pre className="text-xs whitespace-pre-wrap text-on-surface-variant/80">
          {truncate(input.prompt, MAX_PROMPT_LENGTH)}
        </pre>
      ) : null}
    </div>
  );
}

function TaskResultView({ result, isError }: { result: TaskResult; isError: boolean }) {
  if (!result) {
    return <div className="text-xs text-on-surface-variant">No result</div>;
  }

  return (
    <div className="task-tool-result space-y-1.5">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant">
        <span className={`font-medium ${isError ? "text-error" : ""}`}>
          {result.status ?? (isError ? "failed" : "completed")}
        </span>
        {typeof result.totalDurationMs === "number" ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {Math.round(result.totalDurationMs)}ms
          </span>
        ) : null}
        {typeof result.totalTokens === "number" ? (
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            {result.totalTokens} tok
          </span>
        ) : null}
        {typeof result.totalToolUseCount === "number" ? (
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {result.totalToolUseCount}
          </span>
        ) : null}
      </div>
      {Array.isArray(result.content) && result.content.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-on-surface-variant">
            {result.content.length} content blocks
          </summary>
          <pre className="mt-1 text-[11px] whitespace-pre-wrap overflow-auto">
            {JSON.stringify(result.content, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export const taskRenderer: ToolRenderer<TaskInput, TaskResult> = {
  tool: "Task",
  displayName: "Agent",
  renderToolUse(input) {
    return <TaskUse input={input as TaskInput} />;
  },
  renderToolResult(result, isError) {
    return <TaskResultView result={result as TaskResult} isError={isError} />;
  },
  getUseSummary(input) {
    return (input as TaskInput).description ?? (input as TaskInput).subagent_type ?? "Task";
  },
  getResultSummary(_result, isError) {
    return isError ? "Failed" : "Completed";
  },
};
