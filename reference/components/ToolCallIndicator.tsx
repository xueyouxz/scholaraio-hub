import { Wrench } from "lucide-react";
import type React from "react";
import type { ToolCallStatus } from "../types/ui";

interface ToolCallIndicatorProps {
  toolName: string;
  status: ToolCallStatus;
}

const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({ toolName, status }) => {
  if (status === "pending") {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Wrench className="w-3.5 h-3.5" />
          <span>{toolName}</span>
        </div>
        <div className="mt-2 h-1.5 w-36 rounded-full bg-primary/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-primary" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
        status === "done" ? "bg-primary/10 text-primary" : "bg-error-container/20 text-error"
      }`}
    >
      <Wrench className="w-3 h-3" />
      {toolName}
    </div>
  );
};

export default ToolCallIndicator;
