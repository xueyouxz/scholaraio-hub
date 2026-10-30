import { type ReactNode, useEffect, useState } from "react";
import { readStoredNumber, writeStored } from "../../../core/browserStorage";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";

/** Shared resize behavior for the original file and literature side panels. */
export function ResizableSessionPanel({
  open,
  title,
  storageKey,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  storageKey: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => {
    const saved = readStoredNumber(storageKey);
    return saved !== undefined && saved >= 220 ? Math.min(600, saved) : 320;
  });
  const [hasOpened, setHasOpened] = useState(open);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);
  const resize = (next: number, done: boolean) => {
    const clamped = Math.max(220, Math.min(window.innerWidth * 0.5, next));
    setWidth(clamped);
    if (done) writeStored(storageKey, String(clamped));
  };
  return (
    <aside
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={`absolute right-0 top-0 z-40 md:static flex h-full shrink-0 justify-end overflow-hidden bg-surface ${dragging ? "" : "transition-[width] duration-200 ease-out"}`}
      style={{ width: open ? `min(${width}px, 85vw)` : 0 }}
    >
      <div className="flex h-full shrink-0" style={{ width: `min(${width}px, 85vw)` }}>
        <ResizeHandle
          label={`调整${title}宽度`}
          width={width}
          grow="left"
          step={20}
          onResize={resize}
          onDraggingChange={setDragging}
          className="w-1 shrink-0 hover:bg-primary/30 active:bg-primary/50"
        />
        <div className="flex-1 border-l border-outline-variant/10 bg-surface flex flex-col min-h-0 overflow-hidden">
          {hasOpened ? children : null}
        </div>
      </div>
    </aside>
  );
}
