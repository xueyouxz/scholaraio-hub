import type { SlashCommand } from "@scholaraio-hub/shared";

/** Commands the composer runs itself; they are never sent to the agent. */
export type ClientCommandName = "model" | "effort" | "permissions" | "attach" | "stop";

const CLIENT_COMMANDS: Record<ClientCommandName, string> = {
  model: "Switch model",
  effort: "Adjust thinking and effort",
  permissions: "Switch permission mode",
  attach: "Attach files",
  stop: "Stop this turn",
};

/** The client commands usable right now, as leading `/name` commands. */
export function clientCommands(available: Iterable<ClientCommandName>): SlashCommand[] {
  return [...available].map((name) => ({
    name,
    description: CLIENT_COMMANDS[name],
    source: "client",
    trigger: "/",
    position: "leading",
  }));
}

export function isClientCommand(
  command: SlashCommand,
): command is SlashCommand & { name: ClientCommandName; source: "client" } {
  return command.source === "client" && command.name in CLIENT_COMMANDS;
}
