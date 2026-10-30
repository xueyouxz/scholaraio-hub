import type { ReactNode } from "react";

export interface Chip<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * A row of filter chips, one of them chosen: which agent's sessions, which
 * view of a paper. Drawn as `.design/DESIGN.md` has it ("Source / Filter Chips").
 */
export function ChipGroup<T extends string>({
  label,
  chips,
  value,
  onChange,
}: {
  /** What the row chooses, for assistive technology. */
  label: string;
  chips: readonly Chip<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset aria-label={label} className="m-0 flex min-w-0 items-center gap-1.5 border-0 p-0">
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          aria-pressed={chip.value === value}
          disabled={chip.disabled}
          onClick={() => onChange(chip.value)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-30 ${
            chip.value === value
              ? "bg-primary text-on-primary border-primary"
              : "bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"
          }`}
        >
          {chip.icon}
          {chip.label}
        </button>
      ))}
    </fieldset>
  );
}
