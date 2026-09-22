import { Markdown } from "../../../../shared/components/Markdown";
import { CodeBlock, OutputTail } from "./blocks";
import {
  type ToolRenderer,
  type ToolView,
  contentText,
  field,
  fileName,
  numberField,
  plural,
  truncate,
} from "./types";

function lineCount(text: string): number {
  const trimmed = text.replace(/\n$/, "");
  return trimmed ? trimmed.split("\n").length : 0;
}

/** Output of a command: Claude reports stdout/stderr apart; Codex one stream. */
function commandOutput(view: ToolView): { stdout: string; stderr: string } {
  const detail = view.result?.detail;
  const stdout = field(detail, "stdout");
  const stderr = field(detail, "stderr");
  if (stdout || stderr) return { stdout, stderr };
  const text = contentText(view.result);
  return view.result?.isError ? { stdout: "", stderr: text } : { stdout: text, stderr: "" };
}

export const bashRenderer: ToolRenderer = {
  tool: "Bash",
  verb: { pending: "Running", done: "Ran" },
  summary: (view) =>
    field(view.input, "description") || truncate(field(view.input, "command"), 80) || "…",
  resultSummary: (view) => {
    if (view.running || !view.result) return undefined;
    const { stdout, stderr } = commandOutput(view);
    if (view.result.isError) return stderr.split("\n")[0]?.slice(0, 80) || "failed";
    const lines = lineCount(stdout);
    return lines ? plural(lines, "line") : "no output";
  },
  preview: (view) => {
    const { stdout, stderr } = commandOutput(view);
    return <OutputTail text={stderr || stdout} error={!!stderr && view.result?.isError} />;
  },
  body: (view) => {
    const { stdout, stderr } = commandOutput(view);
    return (
      <>
        <CodeBlock text={field(view.input, "command")} maxLines={12} />
        {stdout ? <CodeBlock text={stdout} /> : null}
        {stderr ? <CodeBlock text={stderr} error={view.result?.isError} /> : null}
      </>
    );
  },
};

/** Claude Code's Read result: the file slice plus where it starts. */
function readFile(view: ToolView): { text: string; startLine?: number; lines: number } {
  const file = (view.result?.detail as { file?: unknown } | undefined)?.file;
  const content = field(file, "content");
  if (content) {
    return {
      text: content,
      startLine: numberField(file, "startLine") ?? 1,
      lines: numberField(file, "numLines") ?? lineCount(content),
    };
  }
  const text = contentText(view.result);
  return { text, lines: lineCount(text) };
}

export const readRenderer: ToolRenderer = {
  tool: "Read",
  verb: { pending: "Reading", done: "Read" },
  summary: (view) => {
    const path = fileName(field(view.input, "file_path")) || "…";
    const offset = numberField(view.input, "offset");
    const limit = numberField(view.input, "limit");
    if (offset === undefined) return path;
    return limit === undefined ? `${path}:${offset}` : `${path}:${offset}-${offset + limit - 1}`;
  },
  resultSummary: (view) => {
    if (!view.result) return undefined;
    if (view.result.isError) return truncate(contentText(view.result), 80);
    return plural(readFile(view).lines, "line");
  },
  body: (view) => {
    if (!view.result) return null;
    if (view.result.isError) return <CodeBlock text={contentText(view.result)} error />;
    const file = readFile(view);
    return <CodeBlock text={file.text} startLine={file.startLine} />;
  },
};

export const writeRenderer: ToolRenderer = {
  tool: "Write",
  verb: { pending: "Writing", done: "Wrote" },
  summary: (view) => fileName(field(view.input, "file_path")) || "…",
  resultSummary: (view) =>
    view.result && !view.result.isError
      ? plural(lineCount(field(view.input, "content")), "line")
      : view.result
        ? truncate(contentText(view.result), 80)
        : undefined,
  preview: (view) => <OutputTail text={field(view.input, "content")} lines={4} />,
  body: (view) => <CodeBlock text={field(view.input, "content")} startLine={1} />,
};

/** Match counts from Claude Code's Grep/Glob result, falling back to raw output. */
function searchCounts(view: ToolView): { files?: number; lines?: number; filenames: string[] } {
  const detail = view.result?.detail;
  const names = (detail as { filenames?: unknown } | undefined)?.filenames;
  const filenames = Array.isArray(names) ? names.filter((name) => typeof name === "string") : [];
  return {
    files: numberField(detail, "numFiles"),
    lines: numberField(detail, "numLines"),
    filenames,
  };
}

export const grepRenderer: ToolRenderer = {
  tool: "Grep",
  verb: { pending: "Searching", done: "Searched" },
  summary: (view) => {
    const pattern = field(view.input, "pattern");
    const path = field(view.input, "path");
    return `"${truncate(pattern, 40)}"${path ? ` in ${fileName(path)}` : ""}`;
  },
  resultSummary: (view) => {
    if (!view.result || view.result.isError) return undefined;
    const { files, lines } = searchCounts(view);
    if (lines !== undefined) return plural(lines, "line");
    if (files !== undefined) return files ? plural(files, "file") : "no matches";
    const text = contentText(view.result);
    return text.trim() ? plural(lineCount(text), "line") : "no matches";
  },
  body: (view) => {
    const { filenames } = searchCounts(view);
    const text = field(view.result?.detail, "content") || contentText(view.result);
    return <CodeBlock text={filenames.length && !text.trim() ? filenames.join("\n") : text} />;
  },
};

export const globRenderer: ToolRenderer = {
  tool: "Glob",
  verb: { pending: "Finding", done: "Found" },
  summary: (view) => field(view.input, "pattern") || "…",
  resultSummary: (view) => {
    if (!view.result || view.result.isError) return undefined;
    const { files, filenames } = searchCounts(view);
    const count = files ?? (filenames.length || lineCount(contentText(view.result)));
    return count ? plural(count, "file") : "no files";
  },
  body: (view) => {
    const { filenames } = searchCounts(view);
    return <CodeBlock text={filenames.length ? filenames.join("\n") : contentText(view.result)} />;
  },
};

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

function todos(view: ToolView): Todo[] {
  const list = (view.input as { todos?: unknown } | undefined)?.todos;
  return Array.isArray(list)
    ? list.filter((todo): todo is Todo => typeof field(todo, "content") === "string")
    : [];
}

const TODO_MARK: Record<Todo["status"], string> = {
  pending: "☐",
  in_progress: "◐",
  completed: "☑",
};

export const todoWriteRenderer: ToolRenderer = {
  tool: "TodoWrite",
  verb: { pending: "Updating plan", done: "Updated plan" },
  summary: (view) => {
    const list = todos(view);
    const done = list.filter((todo) => todo.status === "completed").length;
    return list.length ? `${done}/${list.length} done` : "…";
  },
  defaultExpanded: () => true,
  body: (view) => (
    <ul className="todo-list">
      {todos(view).map((todo) => (
        <li key={todo.content} className={`todo-item todo-status-${todo.status.replace("_", "-")}`}>
          <span className="todo-checkbox" aria-hidden="true">
            {TODO_MARK[todo.status] ?? TODO_MARK.pending}
          </span>
          <span className={`todo-content${todo.status === "completed" ? " todo-completed" : ""}`}>
            {todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}
          </span>
        </li>
      ))}
    </ul>
  ),
};

export const webSearchRenderer: ToolRenderer = {
  tool: "WebSearch",
  verb: { pending: "Searching web", done: "Searched web" },
  summary: (view) => truncate(field(view.input, "query"), 60) || "…",
  resultSummary: (view) => {
    const results = (view.result?.detail as { results?: unknown } | undefined)?.results;
    return Array.isArray(results) && results.length ? plural(results.length, "result") : undefined;
  },
  body: (view) => <CodeBlock text={contentText(view.result)} />,
};

export const webFetchRenderer: ToolRenderer = {
  tool: "WebFetch",
  verb: { pending: "Fetching", done: "Fetched" },
  summary: (view) => truncate(field(view.input, "url"), 60) || "…",
  body: (view) => (
    <>
      {field(view.input, "prompt") ? <CodeBlock text={field(view.input, "prompt")} /> : null}
      {view.result ? (
        <CodeBlock text={contentText(view.result)} error={view.result.isError} />
      ) : null}
    </>
  ),
};

/** Subagent: the result is the subagent's final report, usually markdown. */
export const taskRenderer: ToolRenderer = {
  tool: "Task",
  verb: { pending: "Running agent", done: "Agent" },
  summary: (view) =>
    truncate(field(view.input, "description") || field(view.input, "subagent_type"), 60) || "…",
  body: (view) => (
    <>
      {field(view.input, "prompt") ? (
        <details className="task-prompt">
          <summary>Prompt</summary>
          <CodeBlock text={field(view.input, "prompt")} />
        </details>
      ) : null}
      {view.result ? (
        view.result.isError ? (
          <CodeBlock text={contentText(view.result)} error />
        ) : (
          <Markdown text={contentText(view.result)} className="session-markdown task-result" />
        )
      ) : null}
    </>
  ),
};

/** The agent's questions and, once answered, what the user chose. */
export const askUserQuestionRenderer: ToolRenderer = {
  tool: "AskUserQuestion",
  verb: { pending: "Asking", done: "Asked" },
  askedInline: true,
  summary: (view) => {
    const questions = (view.input as { questions?: unknown } | undefined)?.questions;
    const first = Array.isArray(questions) ? field(questions[0], "question") : "";
    return truncate(first, 60) || "…";
  },
  defaultExpanded: () => true,
  body: (view) => {
    const questions = (view.input as { questions?: unknown } | undefined)?.questions;
    const answers =
      (view.input as { answers?: Record<string, unknown> } | undefined)?.answers ?? {};
    return (
      <>
        <ul className="question-list">
          {(Array.isArray(questions) ? questions : []).map((question) => {
            const text = field(question, "question");
            const answer = answers[text];
            return (
              <li key={text} className="question-item">
                <span className="question-header">{text}</span>
                {typeof answer === "string" && answer ? (
                  <span className="question-answer"> → {answer}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {view.result && !Object.keys(answers).length ? (
          <CodeBlock text={contentText(view.result)} error={view.result.isError} />
        ) : null}
      </>
    );
  },
};

/** A plan the agent proposes before leaving plan mode. */
export const exitPlanModeRenderer: ToolRenderer = {
  tool: "ExitPlanMode",
  verb: { pending: "Proposing plan", done: "Proposed plan" },
  askedInline: true,
  summary: (view) => (view.result?.isError ? "not approved" : ""),
  defaultExpanded: () => true,
  body: (view) => (
    <Markdown text={field(view.input, "plan")} className="session-markdown exitplan-inline" />
  ),
};

/** Anything without a dedicated renderer: show what was sent and what came back. */
export const fallbackRenderer: ToolRenderer = {
  tool: "*",
  summary: (view) => {
    if (!view.input || typeof view.input !== "object") return "…";
    const data = view.input as Record<string, unknown>;
    if (Array.isArray(data.command)) return truncate(data.command.join(" "), 80);
    for (const value of Object.values(data)) {
      if (typeof value === "string" && value.length > 0 && value.length < 100) {
        return truncate(value, 40);
      }
    }
    return "…";
  },
  body: (view) => (
    <>
      <CodeBlock text={JSON.stringify(view.input ?? {}, null, 2)} maxLines={20} />
      {view.result ? (
        <CodeBlock text={contentText(view.result)} error={view.result.isError} />
      ) : null}
    </>
  ),
};
