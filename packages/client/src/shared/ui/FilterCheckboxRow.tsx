interface FilterCheckboxRowProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export function FilterCheckboxRow({ label, checked = false, onChange }: FilterCheckboxRowProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`rounded border h-5 w-5 inline-flex items-center justify-center shrink-0 ${
          checked ? "border-primary bg-primary text-on-primary" : "border-outline text-transparent"
        }`}
      >
        ✓
      </span>
      <span className={checked ? "text-sm text-on-surface" : "text-sm text-on-surface-variant"}>
        {label}
      </span>
    </label>
  );
}
