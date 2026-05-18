import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import { Brain, ChevronDown, Mic, Pause, ShieldCheck } from "lucide-react";
import type { ThinkingOption } from "../../../core/types";
import { ContextUsageIndicator } from "./ContextUsageIndicator";

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: "Default",
  acceptEdits: "Accept edits",
  bypassPermissions: "Bypass",
  plan: "Plan",
};

const THINKING_LABELS: Record<ThinkingOption, string> = {
  off: "No thinking",
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
  "on:low": "Think low",
  "on:medium": "Think medium",
  "on:high": "Think high",
  "on:max": "Think max",
};

const THINKING_OPTIONS: ThinkingOption[] = ["off", "auto", "on:low", "on:medium", "on:high"];

interface Props {
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  thinking: ThinkingOption;
  onThinkingChange: (value: ThinkingOption) => void;
  isHeld?: boolean;
  onHoldChange?: (held: boolean) => void;
  voiceListening: boolean;
  voiceSupported: boolean;
  onToggleVoice: () => void;
  contextUsage?: ContextUsage;
  supportsPermissionMode?: boolean;
}

export function MessageInputToolbar({
  permissionMode,
  onPermissionModeChange,
  thinking,
  onThinkingChange,
  isHeld,
  onHoldChange,
  voiceListening,
  voiceSupported,
  onToggleVoice,
  contextUsage,
  supportsPermissionMode = true,
}: Props) {
  const pillBase =
    "flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap";
  const pillIdle = "text-on-surface-variant hover:bg-surface-container hover:text-on-surface";
  const iconBase =
    "p-1.5 rounded-lg transition-colors text-on-surface-variant hover:bg-surface-container hover:text-on-surface";

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {/* Permission mode selector */}
      {supportsPermissionMode ? (
        <div className="relative inline-flex">
          <button type="button" className={`${pillBase} ${pillIdle}`} tabIndex={-1}>
            <ShieldCheck size={12} aria-hidden="true" />
            {PERMISSION_LABELS[permissionMode]}
            <ChevronDown size={10} aria-hidden="true" />
          </button>
          <select
            value={permissionMode}
            onChange={(event) => onPermissionModeChange(event.target.value as PermissionMode)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
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

      {/* Thinking selector */}
      <div className="relative inline-flex">
        <button
          type="button"
          className={`${pillBase} ${
            thinking !== "off" && thinking !== "auto"
              ? "text-primary bg-primary/5 hover:bg-primary/10"
              : pillIdle
          }`}
          tabIndex={-1}
        >
          <Brain size={12} aria-hidden="true" />
          {THINKING_LABELS[thinking] ?? thinking}
          <ChevronDown size={10} aria-hidden="true" />
        </button>
        <select
          value={thinking}
          onChange={(event) => onThinkingChange(event.target.value as ThinkingOption)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          aria-label="Thinking mode"
        >
          {THINKING_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {THINKING_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {/* Hold button */}
      {onHoldChange ? (
        <button
          type="button"
          onClick={() => onHoldChange(!isHeld)}
          aria-pressed={isHeld}
          title={isHeld ? "Resume from hold" : "Hold after current step"}
          className={`${iconBase} ${isHeld ? "bg-surface-container-high text-on-surface" : ""}`}
        >
          <Pause size={13} aria-hidden="true" />
        </button>
      ) : null}

      {/* Context usage indicator */}
      <ContextUsageIndicator usage={contextUsage} />

      {/* Voice input */}
      {voiceSupported ? (
        <button
          type="button"
          onClick={onToggleVoice}
          title={voiceListening ? "Stop voice input" : "Start voice input"}
          aria-pressed={voiceListening}
          className={`${iconBase} ${voiceListening ? "bg-error/10 text-error hover:bg-error/20" : ""}`}
        >
          <Mic size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
