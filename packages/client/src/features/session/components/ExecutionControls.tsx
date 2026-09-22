import type { PermissionMode, ThinkingOption } from "@scholaraio-hub/shared";
import { Brain, ChevronDown } from "lucide-react";
import { ModeSelector } from "./ModeSelector";

export function ExecutionControls({
  permissionMode,
  thinking,
  onChange,
  disabled,
  supportsThinking = true,
  supportsPermission = true,
}: {
  permissionMode: PermissionMode;
  thinking: ThinkingOption;
  onChange: (value: { permissionMode?: PermissionMode; thinking?: ThinkingOption }) => void;
  disabled?: boolean;
  supportsThinking?: boolean;
  supportsPermission?: boolean;
}) {
  return (
    <>
      {supportsPermission ? (
        <ModeSelector
          mode={permissionMode}
          disabled={disabled}
          onModeChange={(permissionMode) => onChange({ permissionMode })}
        />
      ) : null}
      {supportsThinking ? (
        <div className="relative inline-flex rounded-lg focus-within:ring-2 focus-within:ring-primary/40">
          <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg text-on-surface-variant">
            <Brain size={12} />
            {thinking === "auto"
              ? "Auto"
              : thinking === "off"
                ? "No thinking"
                : thinking.replace("on:", "Think ")}
            <ChevronDown size={10} />
          </span>
          <select
            aria-label="Thinking mode"
            disabled={disabled}
            value={thinking}
            onChange={(e) => onChange({ thinking: e.target.value as ThinkingOption })}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          >
            <option value="off">No thinking</option>
            <option value="auto">Auto</option>
            <option value="on:low">Think low</option>
            <option value="on:medium">Think medium</option>
            <option value="on:high">Think high</option>
            <option value="on:max">Think max</option>
          </select>
        </div>
      ) : null}
    </>
  );
}
