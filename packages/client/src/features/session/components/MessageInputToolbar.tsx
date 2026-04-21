import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import { ChevronDown, Mic, ShieldCheck } from "lucide-react";
import { ContextUsageIndicator } from "./ContextUsageIndicator";

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: "Default",
  acceptEdits: "Accept edits",
  bypassPermissions: "Bypass",
  plan: "Plan",
};

interface Props {
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  voiceListening: boolean;
  voiceSupported: boolean;
  onToggleVoice: () => void;
  contextUsage?: ContextUsage;
  supportsPermissionMode?: boolean;
}

export function MessageInputToolbar({
  permissionMode,
  onPermissionModeChange,
  voiceListening,
  voiceSupported,
  onToggleVoice,
  contextUsage,
  supportsPermissionMode = true,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {supportsPermissionMode ? (
        <div className="relative flex items-center gap-1 cursor-pointer rounded-xl px-2 py-1 hover:bg-surface-container-high">
          <ShieldCheck className="w-3.5 h-3.5 text-on-surface-variant" />
          <span className="text-[12px] font-medium text-on-surface-variant whitespace-nowrap pointer-events-none">
            {PERMISSION_LABELS[permissionMode]}
          </span>
          <ChevronDown className="w-3 h-3 text-on-surface-variant/60 shrink-0 pointer-events-none" />
          <select
            value={permissionMode}
            onChange={(event) => onPermissionModeChange(event.target.value as PermissionMode)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full !border-0 !bg-transparent !p-0 !rounded-none !min-h-0"
            aria-label="Permission mode"
          >
            {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {PERMISSION_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ContextUsageIndicator usage={contextUsage} />

      {voiceSupported ? (
        <button
          type="button"
          onClick={onToggleVoice}
          title={voiceListening ? "Stop voice input" : "Start voice input"}
          aria-pressed={voiceListening}
          className={`flex items-center justify-center w-8 h-8 rounded-xl !border-0 !bg-transparent !p-0 hover:![transform:none] cursor-pointer transition-colors ${
            voiceListening
              ? "text-error bg-error-container/30 animate-pulse"
              : "text-on-surface-variant hover:bg-surface-container-high"
          }`}
        >
          <Mic className="w-[18px] h-[18px]" />
        </button>
      ) : null}
    </div>
  );
}
