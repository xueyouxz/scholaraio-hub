import { AlertTriangle } from "lucide-react";
import type { ZodError } from "zod";

interface SchemaWarningProps {
  toolName: string;
  errors: ZodError;
}

export function SchemaWarning({ toolName, errors }: SchemaWarningProps) {
  return (
    <details className="schema-warning text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg p-2 my-2">
      <summary className="flex items-center gap-1.5 cursor-pointer">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Schema validation issue: {toolName}</span>
      </summary>
      <pre className="mt-2 overflow-auto text-[11px]">{JSON.stringify(errors.issues, null, 2)}</pre>
    </details>
  );
}
