import type { PermissionMode } from "@scholaraio-hub/shared";
import { Check, ChevronDown, Pause, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MODE_ORDER: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

const MODE_LABELS: Record<PermissionMode, string> = {
  default: "Default",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Bypass",
};

interface ModeSelectorProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  isHeld?: boolean;
  onHoldChange?: (held: boolean) => void;
  disabled?: boolean;
}

export function ModeSelector({
  mode,
  onModeChange,
  isHeld,
  onHoldChange,
  disabled,
}: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectMode = (nextMode: PermissionMode) => {
    if (isHeld) {
      onHoldChange?.(false);
    }
    onModeChange(nextMode);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap ${
          isHeld
            ? "bg-surface-container-high text-on-surface"
            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        }`}
      >
        {isHeld ? (
          <Pause size={12} aria-hidden="true" />
        ) : (
          <ShieldCheck size={12} aria-hidden="true" />
        )}
        {isHeld ? "Held" : MODE_LABELS[mode]}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 bottom-full mb-2 z-20 min-w-48 rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl p-1">
          {onHoldChange ? (
            <button
              type="button"
              onClick={() => {
                onHoldChange(!isHeld);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container"
            >
              <Pause size={13} aria-hidden="true" />
              <span className="flex-1">{isHeld ? "Resume" : "Hold after current step"}</span>
              {isHeld ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ) : null}
          {onHoldChange ? <div className="my-1 h-px bg-outline-variant/20" /> : null}
          {MODE_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => selectMode(option)}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container"
            >
              <ShieldCheck size={13} aria-hidden="true" />
              <span className="flex-1">{MODE_LABELS[option]}</span>
              {!isHeld && option === mode ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
