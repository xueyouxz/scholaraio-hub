import type { SlashCommand } from "@scholaraio-hub/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Encapsulates the slash-command picker state machine: filtering, keyboard
 * navigation index, dismissed flag, and recognition of an already-selected
 * command from the prefix.
 *
 * `messageBody` is the user-editable portion of the message — when a command
 * is selected, the `/foo` prefix is hidden in a separate badge and `messageBody`
 * is what shows up in the textarea.
 */
export interface SlashPickerState {
  /** Filtered list of commands matching the current `/query` (or null when no picker). */
  filter: SlashCommand[] | null;
  /** Whether the suggestion dropdown should render. */
  showList: boolean;
  /** Whether to render the badge for an already-selected command. */
  showBadge: boolean;
  /** The currently selected command (when showBadge is true). */
  selectedCommand: SlashCommand | null;
  /** The `/foo` token of the selected command (empty string if none). */
  selectedToken: string;
  /** Active suggestion index for keyboard navigation. */
  activeIndex: number;
  /** Body of the message with the slash token stripped (for badge mode). */
  messageBody: string;
  setActiveIndex: (index: number | ((prev: number) => number)) => void;
  /** Mark the suggestions as dismissed (Esc / selection). */
  dismiss: () => void;
  /** Reset dismissed flag (when user resumes typing). */
  resume: () => void;
}

export function useSlashCommandPicker(
  message: string,
  slashCommands: SlashCommand[] | undefined,
): SlashPickerState {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filter = useMemo(() => {
    if (!message.startsWith("/")) return null;
    const query = message.slice(1);
    if (/\s/.test(query)) return null;
    if (!slashCommands || slashCommands.length === 0) return null;
    const normalizedQuery = query.toLowerCase();
    return slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(normalizedQuery));
  }, [message, slashCommands]);

  const showList = Boolean(!dismissed && filter && filter.length > 0 && message.startsWith("/"));
  const filterSignature = filter?.map((cmd) => cmd.name).join("\n") ?? "";

  // Reset active index when the filtered set changes.
  useEffect(() => {
    if (!filterSignature) return;
    setActiveIndex(0);
  }, [filterSignature]);

  const selectedCommand = useMemo(() => {
    if (!slashCommands || slashCommands.length === 0) return null;
    return (
      [...slashCommands]
        .sort((a, b) => b.name.length - a.name.length)
        .find((cmd) => message === `/${cmd.name}` || message.startsWith(`/${cmd.name} `)) ?? null
    );
  }, [message, slashCommands]);

  const selectedToken = selectedCommand ? `/${selectedCommand.name}` : "";
  const showBadge = Boolean(
    selectedCommand &&
      (message.startsWith(`${selectedToken} `) || (dismissed && message === selectedToken)),
  );
  const messageBody = showBadge ? message.slice(selectedToken.length).replace(/^ /, "") : message;

  const dismiss = useCallback(() => setDismissed(true), []);
  const resume = useCallback(() => setDismissed(false), []);

  return {
    filter,
    showList,
    showBadge,
    selectedCommand,
    selectedToken,
    activeIndex,
    messageBody,
    setActiveIndex,
    dismiss,
    resume,
  };
}
