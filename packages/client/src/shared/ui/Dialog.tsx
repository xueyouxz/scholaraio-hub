import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * A modal built on the platform's own dialog element.
 *
 * `showModal` brings the focus trap, the escape key and the inert background
 * with it, so this only adds the surface: the atelier's own elevation, a
 * serif title and a ghost close control. Escape and that control are the two
 * ways out; the backdrop is not clickable, so a stray click cannot discard
 * what the dialog is in the middle of.
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
  children: React.ReactNode;
  /** Room for a working surface rather than a confirmation. */
  wide?: boolean;
  /**
   * A fixed height, so content that comes and goes (a validation message, a
   * result list, a switched tab) scrolls inside instead of resizing the box.
   */
  tall?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.showModal();
    // The dialog holds the page inert while it is open; closing it releases that.
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      // A close event can arrive after the dialog was shown again (an effect
      // re-run closes and reopens it); only one that left it closed is the user's.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
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
    </dialog>
  );
}
