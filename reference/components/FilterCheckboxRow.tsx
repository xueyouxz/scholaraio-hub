import type React from "react";

interface FilterCheckboxRowProps {
  label: string;
  checked?: boolean;
}

const FilterCheckboxRow: React.FC<FilterCheckboxRowProps> = ({ label, checked = false }) => (
  <label className="flex items-center gap-3 cursor-default group">
    <span
      className={`rounded border h-5 w-5 inline-flex items-center justify-center ${
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

export default FilterCheckboxRow;
