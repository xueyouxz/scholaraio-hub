import type { SlashCommand } from "@scholaraio-hub/shared";

/** Commands whose name starts with the query, case-insensitively, in their given order. */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const normalized = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(normalized));
}

/** What the leading-command helpers read of a command (a research skill has as much). */
type Named = Pick<SlashCommand, "name">;

/** The command the message already starts with (`/name` or `/name ...`), longest name wins. */
export function findLeadingCommand<C extends Named>(message: string, commands: C[]): C | null {
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
  command: Named | null,
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

/**
 * Lead the message with `/name` in place of `current`, the command it leads
 * with now; choosing `current` again takes it off and keeps the rest.
 */
export function toggleLeadingCommand(message: string, current: string | null, name: string) {
  const { body } = splitLeadingCommand(message, current ? { name: current } : null, true);
  return current === name ? body : joinLeadingCommand(`/${name}`, body);
}

/** Put `args` right after the message's leading `/name`, before what the user wrote. */
export function withCommandArguments(message: string, name: string, args: string[]): string {
  const { token, body } = splitLeadingCommand(message, { name }, true);
  if (!token || !args.length) return message;
  return joinLeadingCommand(token, [args.join(" "), body].filter(Boolean).join(" "));
}

/** A `/query` being typed: its span in the text and whether it opens the message. */
export interface SlashToken {
  start: number;
  end: number;
  query: string;
  leading: boolean;
}

/**
 * The `/word` the caret is in or right after, if any. A token counts only at
 * the start of the text or after whitespace, so paths like `a/b` never trigger.
 */
export function slashTokenAt(text: string, caret: number): SlashToken | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start--;
  if (text[start] !== "/") return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end] ?? "")) end++;
  const query = text.slice(start + 1, caret);
  if (query.includes("/")) return null;
  return { start, end, query, leading: start === 0 };
}

/** Commands a token may complete to: leading-only ones need the token to open the message. */
export function commandsForToken(commands: SlashCommand[], token: SlashToken): SlashCommand[] {
  const allowed = token.leading
    ? commands
    : commands.filter((command) => command.position === "anywhere");
  return filterCommands(allowed, token.query);
}

/** What selecting `command` puts in place of the token: `/name ` or a Codex `$name ` mention. */
export function tokenReplacement(command: SlashCommand): string {
  return `${command.trigger ?? "/"}${command.name} `;
}

/** Replace the token with `replacement`; returns the new text and where the caret goes. */
export function replaceToken(
  text: string,
  token: SlashToken,
  replacement: string,
): { text: string; caret: number } {
  const after = text.slice(token.end).replace(/^ /, "");
  return {
    text: `${text.slice(0, token.start)}${replacement}${after}`,
    caret: token.start + replacement.length,
  };
}

/** One entry per invocation form; earlier lists win (client commands over provider ones). */
export function dedupeCommands(...lists: SlashCommand[][]): SlashCommand[] {
  const seen = new Set<string>();
  return lists.flat().filter((command) => {
    const key = `${command.trigger ?? "/"}${command.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
