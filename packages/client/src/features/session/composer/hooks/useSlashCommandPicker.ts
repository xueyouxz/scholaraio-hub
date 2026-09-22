import type { SlashCommand } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterCommands,
  findLeadingCommand,
  leadingSlashQuery,
  splitLeadingCommand,
} from "../model/slashCommands";

/**
 * Slash-command picker state: which suggestions show, the active one, and the
 * command already chosen at the start of the message (rendered as a badge, so
 * `messageBody` is what the textarea shows).
 */
export interface SlashPickerState {
  /** Commands matching the `/query` being typed, or null when not typing one. */
  filter: SlashCommand[] | null;
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

export function useSlashCommandPicker(
  message: string,
  commands: SlashCommand[] | undefined,
): SlashPickerState {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filter = useMemo(() => {
    const query = leadingSlashQuery(message);
    if (query === null || !commands?.length) return null;
    return filterCommands(commands, query);
  }, [message, commands]);

  const showList = Boolean(!dismissed && filter && filter.length > 0);
  const filterSignature = filter?.map((command) => command.name).join("\n") ?? "";

  useEffect(() => {
    if (!filterSignature) return;
    setActiveIndex(0);
  }, [filterSignature]);

  const selectedCommand = useMemo(
    () => (commands?.length ? findLeadingCommand(message, commands) : null),
    [message, commands],
  );
  const { token, body } = splitLeadingCommand(message, selectedCommand, dismissed);

  const dismiss = useCallback(() => setDismissed(true), []);
  const resume = useCallback(() => setDismissed(false), []);

  return {
    filter,
    showList,
    showBadge: !!token,
    selectedCommand,
    selectedToken: token,
    activeIndex,
    messageBody: body,
    setActiveIndex,
    dismiss,
    resume,
  };
}
