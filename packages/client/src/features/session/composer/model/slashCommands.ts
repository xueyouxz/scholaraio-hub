import type { SlashCommand } from "@scholaraio-hub/shared";

/** Provider commands first; extra (e.g. research) commands only fill names not already taken. */
export function mergeCommands(base: SlashCommand[], extra: SlashCommand[] = []): SlashCommand[] {
  if (extra.length === 0) return base;
  const known = new Set(base.map((command) => command.name));
  return [...base, ...extra.filter((command) => !known.has(command.name))];
}

/** The `/query` the user is typing at the very start of the message, or null. */
export function leadingSlashQuery(message: string): string | null {
  if (!message.startsWith("/")) return null;
  const query = message.slice(1);
  return /\s/.test(query) ? null : query;
}

/** Commands whose name starts with the query, case-insensitively, in their given order. */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const normalized = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(normalized));
}

/** The command the message already starts with (`/name` or `/name ...`), longest name wins. */
export function findLeadingCommand(message: string, commands: SlashCommand[]): SlashCommand | null {
  return (
    [...commands]
      .sort((a, b) => b.name.length - a.name.length)
      .find(
        (command) => message === `/${command.name}` || message.startsWith(`/${command.name} `),
      ) ?? null
  );
}

export interface LeadingCommandSplit {
  /** `/name` when the command is shown as a badge, else "". */
  token: string;
  /** What the textarea shows: the message without the badge token. */
  body: string;
}

/**
 * Split a message into badge token + editable body. The badge appears once the
 * command is followed by a space, or when the bare token was confirmed (picker dismissed).
 */
export function splitLeadingCommand(
  message: string,
  command: SlashCommand | null,
  confirmed: boolean,
): LeadingCommandSplit {
  if (!command) return { token: "", body: message };
  const token = `/${command.name}`;
  if (message.startsWith(`${token} `)) {
    return { token, body: message.slice(token.length).replace(/^ /, "") };
  }
  if (confirmed && message === token) return { token, body: "" };
  return { token: "", body: message };
}

/** Rebuild the full message from a badge token and the edited body. */
export function joinLeadingCommand(token: string, body: string): string {
  if (!token) return body;
  return `${token}${body ? ` ${body}` : " "}`;
}

/** Text that selecting a command puts in the composer. */
export function commandInsertion(command: SlashCommand): string {
  return `/${command.name} `;
}
