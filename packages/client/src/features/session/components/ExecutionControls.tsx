import type {
  EffortOption,
  PermissionMode,
  ProviderCapabilities,
  ThinkingMode,
} from "@scholaraio-hub/shared";
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
  capabilities,
}: {
  permissionMode: PermissionMode;
  thinking: ThinkingMode;
  effort?: string;
  /** The current model's efforts, as the provider names them. */
  efforts?: EffortOption[];
  defaultEffort?: string;
  onChange: (value: SessionOptions) => void;
  disabled?: boolean;
  /** Unknown until the provider list loads; nothing provider-specific shows before. */
  capabilities?: Pick<ProviderCapabilities, "permissionModes" | "thinkingModes">;
}) {
  const permissionModes = capabilities?.permissionModes ?? [];
  const thinkingModes = capabilities?.thinkingModes ?? [];
  const thinkingLabel = thinkingModes.find((option) => option.id === thinking)?.label;
  const defaultLabel = defaultEffort ? `默认 (${defaultEffort})` : "默认";
  return (
    <>
      {permissionModes.length > 0 ? (
        <ModeSelector
          mode={permissionMode}
          options={permissionModes}
          disabled={disabled}
          onModeChange={(permissionMode) => onChange({ permissionMode })}
        />
      ) : null}
      {thinkingModes.length > 0 ? (
        <PillSelect
          label="Thinking mode"
          icon={<Brain size={12} />}
          text={thinkingLabel ?? thinking}
          value={thinking}
          disabled={disabled}
          options={thinkingModes.map((option) => ({ value: option.id, label: option.label }))}
          onChange={(value) => onChange({ thinking: value as ThinkingMode })}
        />
      ) : null}
      {efforts.length > 0 && !(thinkingModes.length > 0 && thinking === "off") ? (
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
