import { X } from "lucide-react";
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * The platform's own modal dialog, open while it is mounted, with nothing
 * drawn around what it holds.
 *
 * `showModal` brings the focus trap, the escape key and the inert background
 * with it. It is rendered on the body, so it is never part of the row or card
 * that opened it. With `closeOnBackdrop` a click beside the content closes it
 * too — for viewers, where there is nothing to lose; a form leaves it off, so
 * a stray click cannot discard what it is in the middle of.
 */
export function Modal({
  label,
  onClose,
  closeOnBackdrop = false,
  children,
  ...attributes
}: {
  label: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"dialog">, "aria-label" | "onClose" | "open" | "children">) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.showModal();
    // The dialog holds the page inert while it is open; closing it releases that.
    return () => element.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={label}
      // A close event can arrive after the dialog was shown again (an effect
      // re-run closes and reopens it); only one that left it closed is the user's.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
      {...attributes}
    >
      {closeOnBackdrop ? (
        // The keyboard's way out is Escape or the content's own close control.
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onClose}
          className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        />
      ) : null}
      {children}
    </dialog>,
    document.body,
  );
}

/**
 * A modal card: the atelier's own elevation, a serif title and a ghost close
 * control. Escape and that control are the two ways out.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  wide = false,
  tall = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** Room for a working surface rather than a confirmation. */
  wide?: boolean;
  /**
   * A fixed height, so content that comes and goes (a validation message, a
   * result list, a switched tab) scrolls inside instead of resizing the box.
   */
  tall?: boolean;
}) {
  return (
    <Modal
      label={title}
      onClose={onClose}
      className={`hub-dialog rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-0 text-on-surface shadow-2xl ${
        wide ? "w-[min(92vw,44rem)]" : "w-[min(92vw,30rem)]"
      } ${tall ? "h-[min(85vh,42rem)] overflow-hidden" : "max-h-[85vh] overflow-auto"}`}
    >
      <div className={tall ? "flex h-full flex-col" : undefined}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="font-serif text-lg font-bold text-on-surface">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs text-on-surface-variant">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container active:opacity-80 border-0 bg-transparent cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className={tall ? "flex min-h-0 flex-1 flex-col px-6 pb-6 pt-4" : "px-6 pb-6 pt-4"}>
          {children}
        </div>
      </div>
    </Modal>
  );
}
