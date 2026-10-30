import type { SlashCommand } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type SlashToken,
  commandsForToken,
  findLeadingCommand,
  slashTokenAt,
  splitLeadingCommand,
} from "../model/slashCommands";
import type { Typeahead } from "../model/typeahead";

/**
 * Slash-command picker state: which suggestions show for the `/word` at the
 * caret, the active one, and the command already chosen at the start of the
 * message (rendered as a badge, so `messageBody` is what the textarea shows).
 */
export interface SlashPickerState extends Typeahead<SlashCommand> {
  /** The `/word` being completed, in `messageBody` coordinates. */
  token: SlashToken | null;
  showBadge: boolean;
  selectedCommand: SlashCommand | null;
  /** `/name` of the badge command, or "". */
  selectedToken: string;
  messageBody: string;
  /** Show suggestions again once the user keeps typing. */
  resume: () => void;
}

/**
 * @param caret Caret offset in the displayed body; null means its end.
 */
export function useSlashCommandPicker(
  message: string,
  commands: SlashCommand[] | undefined,
  caret: number | null = null,
): SlashPickerState {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Only `/name` commands can open the message as a badge; `$` mentions stay inline.
  const leadingCommands = useMemo(
    () => (commands ?? []).filter((command) => (command.trigger ?? "/") === "/"),
    [commands],
  );
  const selectedCommand = useMemo(
    () => (leadingCommands.length ? findLeadingCommand(message, leadingCommands) : null),
    [message, leadingCommands],
  );
  const { token: selectedToken, body } = splitLeadingCommand(message, selectedCommand, dismissed);

  const position = Math.min(caret ?? body.length, body.length);
  const found = slashTokenAt(body, position);
  // After a badge the body no longer opens the message.
  const token = found && selectedToken ? { ...found, leading: false } : found;
  const matches = token && commands?.length ? commandsForToken(commands, token) : null;

  const open = Boolean(!dismissed && matches && matches.length > 0);
  const matchSignature = matches?.map((command) => command.name).join("\n") ?? "";

  useEffect(() => {
    if (!matchSignature) return;
    setActiveIndex(0);
  }, [matchSignature]);

  const dismiss = useCallback(() => setDismissed(true), []);
  const resume = useCallback(() => setDismissed(false), []);

  return {
    open,
    items: matches ?? [],
    token,
    showBadge: !!selectedToken,
    selectedCommand,
    selectedToken,
    activeIndex,
    messageBody: body,
    setActiveIndex,
    dismiss,
    resume,
  };
}
