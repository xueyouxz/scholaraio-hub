import type { PermissionMode, PermissionModeOption } from "@scholaraio-hub/shared";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ModeSelectorProps {
  mode: PermissionMode;
  /** The provider's permission choices, in its order and naming. */
  options: PermissionModeOption[];
  onModeChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, options, onModeChange, disabled }: ModeSelectorProps) {
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

  if (options.length === 0) return null;
  const current = options.find((option) => option.id === mode);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.description}
        className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
      >
        <ShieldCheck size={12} aria-hidden="true" />
        {current?.label ?? mode}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 bottom-full mb-2 z-20 min-w-48 max-w-72 rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl p-1"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === mode}
              onClick={() => {
                onModeChange(option.id);
                setOpen(false);
              }}
              className="w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container"
            >
              <ShieldCheck size={13} aria-hidden="true" className="mt-px shrink-0" />
              <span className="flex-1">
                <span className="block">{option.label}</span>
                {option.description ? (
                  <span className="block text-[11px] text-on-surface-variant">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {option.id === mode ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
