import type { SlashCommand } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type SlashToken,
  commandsForToken,
  findLeadingCommand,
  slashTokenAt,
  splitLeadingCommand,
} from "../model/slashCommands";

/**
 * Slash-command picker state: which suggestions show for the `/word` at the
 * caret, the active one, and the command already chosen at the start of the
 * message (rendered as a badge, so `messageBody` is what the textarea shows).
 */
export interface SlashPickerState {
  /** Commands matching the token being typed, or null when not typing one. */
  filter: SlashCommand[] | null;
  /** The `/word` being completed, in `messageBody` coordinates. */
  token: SlashToken | null;
  showList: boolean;
  showBadge: boolean;
  selectedCommand: SlashCommand | null;
  /** `/name` of the badge command, or "". */
  selectedToken: string;
  activeIndex: number;
  messageBody: string;
  setActiveIndex: (index: number | ((prev: number) => number)) => void;
  /** Hide suggestions (Esc / selection). */
  dismiss: () => void;
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
  const filter = token && commands?.length ? commandsForToken(commands, token) : null;

  const showList = Boolean(!dismissed && filter && filter.length > 0);
  const filterSignature = filter?.map((command) => command.name).join("\n") ?? "";

  useEffect(() => {
    if (!filterSignature) return;
    setActiveIndex(0);
  }, [filterSignature]);

  const dismiss = useCallback(() => setDismissed(true), []);
  const resume = useCallback(() => setDismissed(false), []);

  return {
    filter,
    token,
    showList,
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
