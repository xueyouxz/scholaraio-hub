import type { SlashCommand } from "@scholaraio-hub/shared";
import { useEffect, useRef } from "react";

interface Props {
  commands: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandSuggestions({ commands, activeIndex, onHover, onSelect }: Props) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-fit max-w-full max-h-64 overflow-y-auto border border-outline-variant/20 rounded-xl bg-surface-container-lowest shadow-lg p-1">
      {commands.map((cmd, index) => (
        <button
          key={cmd.name}
          type="button"
          ref={(element) => {
            optionRefs.current[index] = element;
          }}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(cmd)}
          title={cmd.description || undefined}
          aria-selected={index === activeIndex}
          className={`w-full min-w-max text-left flex items-center px-3 py-2 rounded-lg transition-colors ${
            index === activeIndex ? "bg-surface-container" : "bg-transparent"
          }`}
        >
          <span className="font-mono text-[11px] text-primary font-bold whitespace-nowrap">
            {cmd.trigger ?? "/"}
            {cmd.name}
            {cmd.argumentHint ? ` ${cmd.argumentHint}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
