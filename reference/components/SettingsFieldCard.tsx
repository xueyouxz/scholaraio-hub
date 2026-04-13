import { Pencil } from "lucide-react";
import type React from "react";
import type { SettingsFieldReference } from "../types/ui";

interface SettingsFieldCardProps {
  field: SettingsFieldReference;
}

const SettingsFieldCard: React.FC<SettingsFieldCardProps> = ({ field }) => (
  <div className="space-y-1">
    <div className="flex justify-between items-center">
      <label className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant font-mono">
        {field.label}
      </label>
      <div className="flex items-center gap-2">
        {field.envTag ? (
          <span className="px-2 py-0.5 rounded-lg bg-tertiary-container text-[10px] font-bold text-on-tertiary font-mono">
            {field.envTag}
          </span>
        ) : null}
        <span className="text-on-surface-variant">
          <Pencil className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
    <p className="font-mono text-sm">{field.value}</p>
  </div>
);

export default SettingsFieldCard;
