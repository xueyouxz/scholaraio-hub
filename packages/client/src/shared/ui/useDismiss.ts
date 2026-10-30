import { type RefObject, useEffect, useRef } from "react";

/**
 * Close an open popover (menu, picker, tray) when the reader presses outside
 * it or presses Escape. `inside` are the elements that count as the popover —
 * its trigger's container, and the menu itself when it is portalled elsewhere.
 *
 * The Escape it takes is marked handled (`defaultPrevented`) before anything
 * else sees it, so what holds the popover (a panel, a dialog) can leave that
 * press alone and close only on the next one.
 *
 * The listeners exist only while `open`, and go when it closes or unmounts.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ...inside: RefObject<HTMLElement | null>[]
): void {
  // The latest callback and elements, so an inline `() => setOpen(false)` does
  // not re-subscribe on every render.
  const latest = useRef({ onDismiss, inside });
  latest.current = { onDismiss, inside };
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!latest.current.inside.some((ref) => ref.current?.contains(target)))
        latest.current.onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      latest.current.onDismiss();
    };
    document.addEventListener("pointerdown", away);
    // Capture, so this runs ahead of the holder's own Escape handling.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}
