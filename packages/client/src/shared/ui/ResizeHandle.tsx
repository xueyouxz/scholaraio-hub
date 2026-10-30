import { useEffect, useRef } from "react";

/**
 * The edge of a column the reader drags to resize it, or moves with the arrow
 * keys once focused. It reports widths; the column clamps and keeps them.
 *
 * While dragging, the page keeps the resize cursor and selects no text, and
 * moves are applied once per frame. `onResize` is told `done` when a drag ends
 * and for each key press, the moments a width is worth saving.
 */
export function ResizeHandle({
  label,
  width,
  grow,
  step,
  onResize,
  onDraggingChange,
  className,
}: {
  label: string;
  width: number;
  /** Dragging this way widens the column: `right` for a column on the left edge. */
  grow: "left" | "right";
  /** How far one arrow key press moves the edge. */
  step: number;
  onResize: (width: number, done: boolean) => void;
  /** A drag started or ended, e.g. to pause the column's width transition. */
  onDraggingChange?: (dragging: boolean) => void;
  /** Where the handle sits and how it shows on hover. */
  className: string;
}) {
  const drag = useRef<{ x: number; width: number; next: number; frame: number } | null>(null);
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );
  const widthAt = (x: number) => {
    const start = drag.current;
    if (!start) return width;
    return start.width + (grow === "right" ? x - start.x : start.x - x);
  };
  const end = (x: number) => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    const final = widthAt(x);
    drag.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onResize(final, true);
    onDraggingChange?.(false);
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={`cursor-col-resize touch-none transition-colors ${className}`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const wider = (event.key === "ArrowRight") === (grow === "right");
        onResize(width + (wider ? step : -step), true);
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, next: width, frame: 0 };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        onDraggingChange?.(true);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        state.next = widthAt(event.clientX);
        if (state.frame) return;
        // Pointer moves arrive faster than frames; apply the latest once per frame.
        state.frame = requestAnimationFrame(() => {
          state.frame = 0;
          onResize(state.next, false);
        });
      }}
      onPointerUp={(event) => end(event.clientX)}
      onPointerCancel={(event) => end(event.clientX)}
    />
  );
}
