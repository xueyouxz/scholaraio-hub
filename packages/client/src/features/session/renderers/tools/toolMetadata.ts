export interface ToolGroupMetadata {
  singular: string;
  plural: string;
  group?: false;
}

export const TOOL_NAME_ALIASES: Record<string, string> = {
  shell_command: "Bash",
  exec_command: "Bash",
  write_stdin: "WriteStdin",
  update_plan: "UpdatePlan",
  apply_patch: "Edit",
  web_search_call: "WebSearch",
  search_query: "WebSearch",
  Agent: "Task", // SDK 0.2.76+ renamed Task -> Agent
  view_image: "ViewImage",
  imageView: "ViewImage",
};

export const TOOL_GROUP_METADATA: Record<string, ToolGroupMetadata> = {
  Bash: { singular: "command", plural: "commands" },
  Read: { singular: "file", plural: "files" },
  Edit: { singular: "edit", plural: "edits" },
  Write: { singular: "file", plural: "files" },
  Glob: { singular: "search", plural: "searches" },
  Grep: { singular: "search", plural: "searches" },
  TodoWrite: { singular: "update", plural: "updates" },
  WebSearch: { singular: "search", plural: "searches" },
  WebFetch: { singular: "fetch", plural: "fetches" },
  AskUserQuestion: { singular: "question", plural: "questions" },
  WriteStdin: { singular: "input", plural: "inputs" },
  ViewImage: { singular: "image", plural: "images" },
  BashOutput: { singular: "output", plural: "outputs" },
  TaskOutput: { singular: "output", plural: "outputs" },
  KillShell: { singular: "shell", plural: "shells" },
  Task: { singular: "task", plural: "tasks", group: false },
  UpdatePlan: { singular: "plan", plural: "plans", group: false },
  ExitPlanMode: { singular: "plan", plural: "plans", group: false },
};

export function canonicalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? TOOL_NAME_ALIASES[toolName.toLowerCase()] ?? toolName;
}

export function getToolGroupMetadata(toolName: string): ToolGroupMetadata {
  const canonicalToolName = canonicalizeToolName(toolName);
  return (
    TOOL_GROUP_METADATA[canonicalToolName] ?? {
      singular: "call",
      plural: "calls",
    }
  );
}

export function isToolGroupingDisabled(toolName: string): boolean {
  return getToolGroupMetadata(toolName).group === false;
}
