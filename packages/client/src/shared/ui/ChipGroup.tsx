/** A short, closed set of choices, shown rather than hidden behind a select. */
export function ChipGroup({
  label,
  hint,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer ${
                active
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-high text-on-surface-variant border-outline-variant/30 hover:text-on-surface"
              }`}
            >
              {option.label ?? option.value}
            </button>
          );
        })}
      </div>
      {hint ? <span className="text-xs text-on-surface-variant">{hint}</span> : null}
    </div>
  );
}
