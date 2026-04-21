import { toolRegistry } from "../renderers/tools";
import type { ToolResultData } from "../types/renderItems";
import { getDisplayBashCommandFromInput } from "./bashCommand";

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function getToolSummary(
  toolName: string,
  input: unknown,
  result: ToolResultData | undefined,
  status: "pending" | "complete" | "error" | "aborted",
): string {
  const renderer = toolRegistry.get(toolName);

  if (status === "pending" || status === "aborted") {
    if (renderer.getUseSummary) {
      const summary = safeCall(() => renderer.getUseSummary?.(input));
      if (summary !== undefined) return summary;
    }
    return getDefaultInputSummary(toolName, input);
  }

  let inputSummary: string;
  if (renderer.getUseSummary) {
    const summary = safeCall(() => renderer.getUseSummary?.(input));
    inputSummary = summary ?? getDefaultInputSummary(toolName, input);
  } else {
    inputSummary = getDefaultInputSummary(toolName, input);
  }

  let resultSummary: string;
  if (renderer.getResultSummary) {
    const summary = safeCall(() =>
      renderer.getResultSummary?.(
        result?.structured ?? result?.content,
        result?.isError ?? false,
        input,
      ),
    );
    resultSummary = summary ?? getDefaultResultSummary(toolName, result, status);
  } else {
    resultSummary = getDefaultResultSummary(toolName, result, status);
  }

  if (toolName === "Glob" || toolName === "Grep") {
    return `${inputSummary} → ${resultSummary}`;
  }

  if (toolName === "Bash") {
    return inputSummary;
  }

  if (toolName === "WriteStdin") {
    if (inputSummary && inputSummary !== "waiting for output") {
      return `${inputSummary} → ${resultSummary}`;
    }
    return resultSummary;
  }

  return resultSummary;
}

function getDefaultInputSummary(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return "...";
  }

  const i = input as Record<string, unknown>;

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      if (typeof i.file_path === "string") return getFileName(i.file_path);
      break;
    case "Bash": {
      const command = getDisplayBashCommandFromInput(i);
      if (command) return command;
      break;
    }
    case "Glob":
      if (typeof i.pattern === "string") return i.pattern;
      break;
    case "Grep":
      if (typeof i.pattern === "string") return `"${i.pattern}"`;
      break;
    case "Task":
    case "Agent":
      if (typeof i.description === "string") return truncate(i.description, 30);
      break;
    case "WebSearch":
      if (typeof i.query === "string") return truncate(i.query, 30);
      break;
    case "WebFetch":
      if (typeof i.url === "string") return truncate(i.url, 40);
      break;
  }

  return getFirstStringValue(i);
}

function getFirstStringValue(obj: Record<string, unknown>): string {
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && value.length > 0 && value.length < 100) {
      return truncate(value, 40);
    }
  }
  return "...";
}

function getDefaultResultSummary(
  toolName: string,
  result: ToolResultData | undefined,
  status: "pending" | "complete" | "error" | "aborted",
): string {
  if (status === "error") {
    return "failed";
  }

  if (!result) {
    return "done";
  }

  const content = typeof result.content === "string" ? result.content : "";
  const lineCount = content.split("\n").filter(Boolean).length;

  switch (toolName) {
    case "Read":
      return `${lineCount} lines`;
    case "Bash":
      return `${lineCount} lines`;
    case "Glob":
      return `${lineCount} files`;
    case "Grep":
      return `${lineCount} matches`;
    default:
      return "done";
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}
