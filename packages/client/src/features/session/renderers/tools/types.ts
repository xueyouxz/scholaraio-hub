import type { ReactNode } from "react";
import type { ContentBlock, RenderContext } from "../types";

export interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
  backgroundTaskId?: string;
}

export interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface PdfFile {
  base64: string;
  type: string;
  originalSize?: number;
}

export interface ReadResult {
  type: "text" | "image" | "pdf";
  file: TextFile | ImageFile | PdfFile;
}

export interface TextFile {
  filePath: string;
  content: string;
  numLines: number;
  startLine: number;
  totalLines: number;
}

export interface ImageFile {
  base64: string;
  type: string;
  originalSize?: number;
  dimensions?: {
    originalWidth: number;
    originalHeight: number;
    displayWidth: number;
    displayHeight: number;
  };
}

export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface EditResult {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  replaceAll: boolean;
  userModified: boolean;
  structuredPatch: PatchHunk[];
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface WriteInput {
  file_path: string;
  content: string;
}

export interface WriteResult {
  type: "text";
  file: {
    filePath: string;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
}

export interface TodoWriteInput {
  todos: Todo[];
}

export interface TodoWriteResult {
  oldTodos: Todo[];
  newTodos: Todo[];
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface GlobResult {
  filenames: string[];
  durationMs: number;
  numFiles: number;
  truncated: boolean;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "files_with_matches" | "content" | "count";
}

export interface GrepResult {
  mode: "files_with_matches" | "content" | "count";
  filenames: string[];
  numFiles: number;
  content?: string;
  numLines?: number;
  appliedLimit?: number;
}

export interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: string;
}

export interface TaskResult {
  status: "completed" | "failed" | "timeout";
  prompt: string;
  agentId: string;
  content: ContentBlock[];
  totalDurationMs: number;
  totalTokens: number;
  totalToolUseCount: number;
}

export interface WebSearchInput {
  query: string;
}

export interface WebSearchResult {
  query: string;
  results: Array<{ content: Array<{ title: string; url: string }> }>;
  durationSeconds: number;
}

export interface WebFetchInput {
  url: string;
  prompt: string;
}

export interface WebFetchResult {
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
}

export interface AskUserQuestionInput {
  questions: Question[];
}

export interface Question {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface AskUserQuestionResult {
  questions: Question[];
  answers: Record<string, string>;
}

export interface ExitPlanModeInput {
  plan?: string;
}

export interface ExitPlanModeResult {
  plan: string;
  isAgent: boolean;
  filePath: string;
}

export interface UpdatePlanStep {
  step: string;
  status: "pending" | "in_progress" | "completed" | string;
}

export interface UpdatePlanInput {
  explanation?: string;
  plan?: UpdatePlanStep[];
}

export type UpdatePlanResult = string | { message?: string };

export interface WriteStdinInput {
  session_id?: string | number;
  chars?: string;
  linked_command?: string;
  linked_file_path?: string;
  linked_tool_name?: string;
}

export type WriteStdinResult = string | { content?: string };

export interface BashOutputInput {
  bash_id: string;
  block?: boolean;
  wait_up_to?: number;
}

export interface BashOutputResult {
  shellId: string;
  command: string;
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutLines: number;
  stderrLines: number;
  timestamp: string;
}

export interface TaskOutputInput {
  task_id: string;
  block?: boolean;
  timeout?: number;
}

export interface TaskOutputResult {
  retrieval_status: "completed" | "timeout" | "running";
  task: {
    task_id: string;
    task_type: "local_bash" | "agent";
    status: "running" | "completed" | "failed";
    description: string;
    output: string;
    exitCode: number | null;
  };
}

export interface KillShellInput {
  shell_id: string;
}

export interface KillShellResult {
  message: string;
  shell_id: string;
}

export interface ToolRenderer<TInput = unknown, TResult = unknown> {
  tool: string;
  displayName?: string;
  renderToolUse(input: TInput, context: RenderContext): ReactNode;
  renderToolResult(
    result: TResult,
    isError: boolean,
    context: RenderContext,
    input?: TInput,
  ): ReactNode;
  getUseSummary?(input: TInput): string;
  getResultSummary?(result: TResult, isError: boolean, input?: TInput): string;
  renderInteractiveSummary?(
    input: TInput,
    result: TResult | undefined,
    isError: boolean,
    context: RenderContext,
  ): ReactNode;
  renderCollapsedPreview?(
    input: TInput,
    result: TResult | undefined,
    isError: boolean,
    context: RenderContext,
  ): ReactNode;
  renderInline?(
    input: TInput,
    result: TResult | undefined,
    isError: boolean,
    status: "pending" | "complete" | "error" | "aborted",
    context: RenderContext,
  ): ReactNode;
}
