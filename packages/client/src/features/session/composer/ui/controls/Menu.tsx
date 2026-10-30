import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../../../../shared/ui/useDismiss";

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
}

/** A group of mutually exclusive choices inside a menu, e.g. one layer of effort. */
export interface MenuSection {
  title?: string;
  items: MenuItem[];
  selected?: string;
  onSelect: (id: string) => void;
}

/**
 * A composer pill that opens a single-choice menu above itself. Several
 * sections may share one menu (thinking mode + effort level).
 */
export function MenuButton({
  icon,
  label,
  title,
  sections,
  disabled,
  align = "left",
  openRequest,
}: {
  icon?: ReactNode;
  /** Visible pill text; also the button's accessible name. */
  label: string;
  title?: string;
  sections: MenuSection[];
  disabled?: boolean;
  align?: "left" | "right";
  /** Opens the menu whenever this changes to a new number (e.g. from a /command). */
  openRequest?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [position, setPosition] = useState<CSSProperties>();

  // The pill row scrolls sideways (and so clips), so the menu is fixed to the
  // viewport above its pill instead of positioned inside the row.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 8;
    setPosition({
      position: "fixed",
      bottom: Math.max(window.innerHeight - rect.top + gutter, gutter),
      ...(align === "right"
        ? { right: Math.max(window.innerWidth - rect.right, gutter) }
        : { left: Math.max(rect.left, gutter) }),
    });
  }, [open, align]);

  useDismiss(open, () => setOpen(false), rootRef, menuRef);
  useEffect(() => {
    if (!open) return;
    // A fixed menu would drift from its pill; close it when the layout moves.
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={title ? `${title}：${label}` : label}
        className="hub-composer-pill flex items-center gap-1 min-w-0 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors whitespace-nowrap text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-40"
      >
        {icon}
        <span className="hub-composer-pill-label truncate">{label}</span>
        <ChevronDown size={10} aria-hidden="true" className="shrink-0" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              style={position}
              className="z-50 min-w-48 max-w-[min(20rem,calc(100vw-1rem))] max-h-[min(24rem,60vh)] overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-xl p-1"
            >
              {sections.map((section, index) => (
                <fieldset
                  key={section.title ?? index}
                  aria-label={section.title}
                  className={`m-0 p-0 border-0 min-w-0 ${
                    index > 0 ? "mt-1 pt-1 border-t border-outline-variant/20" : ""
                  }`}
                >
                  {section.title ? (
                    <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
                      {section.title}
                    </div>
                  ) : null}
                  {section.items.map((item) => {
                    const selected = item.id === section.selected;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        disabled={item.disabled}
                        onClick={() => {
                          section.onSelect(item.id);
                          setOpen(false);
                        }}
                        className={`w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
                          selected
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-on-surface hover:bg-surface-container-low"
                        }`}
                      >
                        {item.icon}
                        <span className="flex-1 min-w-0">
                          <span className="block">{item.label}</span>
                          {item.description ? (
                            <span className="block text-[11px] font-normal text-on-surface-variant">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <Check size={13} aria-hidden="true" className="shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </fieldset>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
