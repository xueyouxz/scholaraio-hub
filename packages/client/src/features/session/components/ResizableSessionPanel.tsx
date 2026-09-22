import { type ReactNode, useEffect, useRef, useState } from "react";

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
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 220 ? Math.min(600, saved) : 320;
    } catch (error) {
      console.warn("无法读取侧栏宽度", error);
      return 320;
    }
  });
  const [hasOpened, setHasOpened] = useState(open);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);
  const resize = (next: number) => setWidth(Math.max(220, Math.min(window.innerWidth * 0.5, next)));
  const save = () => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch (error) {
      console.warn("无法保存侧栏宽度", error);
    }
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
        <div
          role="separator"
          aria-label={`调整${title}宽度`}
          aria-orientation="vertical"
          aria-valuenow={width}
          tabIndex={0}
          className="w-1 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50 shrink-0 transition-colors"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(width + (event.key === "ArrowLeft" ? 20 : -20));
            }
          }}
          onBlur={save}
          onPointerDown={(event) => {
            event.preventDefault();
            drag.current = { x: event.clientX, width };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragging(false);
            save();
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        />
        <div className="flex-1 border-l border-outline-variant/10 bg-surface flex flex-col min-h-0 overflow-hidden">
          {hasOpened ? children : null}
        </div>
      </div>
    </aside>
  );
}
