import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ModelInfo } from "../../../core/types";

interface ModelSwitcherProps {
  model?: string;
  models: ModelInfo[];
  onModelChange: (model: string) => Promise<void> | void;
  disabled?: boolean;
}

export function ModelSwitcher({ model, models, onModelChange, disabled }: ModelSwitcherProps) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (models.length === 0) return null;

  const activeModel = model ?? models[0]?.id;
  const activeLabel = models.find((item) => item.id === activeModel)?.name ?? activeModel ?? "";

  const handleChange = async (nextModel: string) => {
    if (!nextModel || nextModel === activeModel) return;
    setSwitching(true);
    setError(null);
    try {
      await onModelChange(nextModel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change model");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative inline-flex" title={error ?? undefined}>
      <button
        type="button"
        className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${
          error
            ? "text-error bg-error-container/20"
            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        }`}
        tabIndex={-1}
      >
        {switching ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : null}
        {activeLabel}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      <select
        value={activeModel}
        onChange={(event) => void handleChange(event.target.value)}
        disabled={disabled || switching}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full disabled:cursor-not-allowed"
        aria-label="Select model"
      >
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
