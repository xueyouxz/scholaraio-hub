import type { ContextUsage, PermissionMode } from "@scholaraio-hub/shared";
import { Brain, ChevronDown } from "lucide-react";
import type { RefObject } from "react";
import type { ThinkingOption } from "../../../core/types";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { ModeSelector } from "./ModeSelector";
import { VoiceInputButton, type VoiceInputButtonRef } from "./VoiceInputButton";

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
  voiceButtonRef?: RefObject<VoiceInputButtonRef | null>;
  onVoiceTranscript?: (transcript: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onListeningStart?: () => void;
  voiceDisabled?: boolean;
  contextUsage?: ContextUsage;
  supportsPermissionMode?: boolean;
  supportsThinkingToggle?: boolean;
}

export function MessageInputToolbar({
  permissionMode,
  onPermissionModeChange,
  thinking,
  onThinkingChange,
  isHeld,
  onHoldChange,
  voiceButtonRef,
  onVoiceTranscript,
  onInterimTranscript,
  onListeningStart,
  voiceDisabled,
  contextUsage,
  supportsPermissionMode = true,
  supportsThinkingToggle = true,
}: Props) {
  const pillBase =
    "flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap";
  const pillIdle = "text-on-surface-variant hover:bg-surface-container hover:text-on-surface";

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {/* Permission mode selector */}
      {supportsPermissionMode ? (
        <ModeSelector
          mode={permissionMode}
          onModeChange={onPermissionModeChange}
          isHeld={isHeld}
          onHoldChange={onHoldChange}
        />
      ) : null}

      {/* Thinking selector */}
      {supportsThinkingToggle ? (
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
      ) : null}

      {/* Context usage indicator */}
      <ContextUsageIndicator usage={contextUsage} />

      {/* Voice input */}
      {voiceButtonRef && onVoiceTranscript && onInterimTranscript ? (
        <VoiceInputButton
          ref={voiceButtonRef}
          onFinalTranscript={onVoiceTranscript}
          onInterimTranscript={onInterimTranscript}
          onListeningStart={onListeningStart}
          disabled={voiceDisabled}
        />
      ) : null}
    </div>
  );
}
