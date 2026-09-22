import type { EffortOption, PermissionMode, ThinkingMode } from "@scholaraio-hub/shared";
import { Brain, ChevronDown, Gauge } from "lucide-react";
import type { SessionOptions } from "../../../core/library";
import { ModeSelector } from "./ModeSelector";

function PillSelect({
  label,
  icon,
  text,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  text: string;
  value: string;
  options: { value: string; label: string; title?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative inline-flex rounded-lg focus-within:ring-2 focus-within:ring-primary/40">
      <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg text-on-surface-variant">
        {icon}
        {text}
        <ChevronDown size={10} />
      </span>
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ExecutionControls({
  permissionMode,
  thinking,
  effort,
  efforts = [],
  defaultEffort,
  onChange,
  disabled,
  supportsThinking = true,
  supportsPermission = true,
}: {
  permissionMode: PermissionMode;
  thinking: ThinkingMode;
  effort?: string;
  /** The current model's efforts, as the provider names them. */
  efforts?: EffortOption[];
  defaultEffort?: string;
  onChange: (value: SessionOptions) => void;
  disabled?: boolean;
  supportsThinking?: boolean;
  supportsPermission?: boolean;
}) {
  const defaultLabel = defaultEffort ? `默认 (${defaultEffort})` : "默认";
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
        <PillSelect
          label="Thinking mode"
          icon={<Brain size={12} />}
          text={thinking === "off" ? "No thinking" : "Adaptive"}
          value={thinking}
          disabled={disabled}
          options={[
            { value: "adaptive", label: "Adaptive" },
            { value: "off", label: "No thinking" },
          ]}
          onChange={(value) => onChange({ thinking: value as ThinkingMode })}
        />
      ) : null}
      {efforts.length > 0 && thinking !== "off" ? (
        <PillSelect
          label="Effort"
          icon={<Gauge size={12} />}
          text={effort ?? defaultLabel}
          value={effort ?? ""}
          disabled={disabled}
          options={[
            { value: "", label: defaultLabel },
            ...efforts.map((option) => ({
              value: option.id,
              label: option.id,
              title: option.description,
            })),
          ]}
          onChange={(value) => onChange({ effort: value })}
        />
      ) : null}
    </>
  );
}
