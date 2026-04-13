import { CheckCircle2, Clock, Database, FileText } from "lucide-react";
import type React from "react";
import type { PathReference } from "../types/ui";

interface SettingsPathRowProps {
  item: PathReference;
}

const iconMap = {
  "Data Directory": Database,
  "Papers Directory": FileText,
  "Pending Directory": Clock,
};

const SettingsPathRow: React.FC<SettingsPathRowProps> = ({ item }) => {
  const Icon = iconMap[item.label as keyof typeof iconMap] ?? Database;

  return (
    <div className="flex items-center justify-between p-4 bg-surface-container-lowest rounded-xl border border-transparent">
      <div className="flex items-center gap-4">
        <Icon className="w-5 h-5 text-on-surface-variant" />
        <div>
          <p className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
            {item.label}
          </p>
          <p className="font-mono text-sm">{item.path}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {item.verified ? <CheckCircle2 className="w-4 h-4 text-primary fill-primary/10" /> : null}
        <span
          className={`px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono ${
            item.source === "env"
              ? "bg-tertiary-container text-on-tertiary"
              : "bg-secondary-container text-on-secondary-container"
          }`}
        >
          {item.source}
        </span>
      </div>
    </div>
  );
};

export default SettingsPathRow;
