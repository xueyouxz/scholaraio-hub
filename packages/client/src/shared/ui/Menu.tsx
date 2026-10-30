import { Check } from "lucide-react";
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
import { useDismiss } from "./useDismiss";

/**
 * Dropdowns as `.design/DESIGN.md` draws them ("Dropdowns & Menus"): a panel
 * on the high surface, rounded, with a shadow, holding items that tint the
 * chosen one. The trigger is the caller's, styled for the toolbar it sits in.
 */

/** Space between a trigger and its panel, and the panel and the window's edge. */
const GAP = 6;

/**
 * A button that opens a panel against itself. The panel closes on a press
 * outside, on Escape, or when its content calls `close`.
 *
 * A trigger inside a container that clips (the composer's scrolling pill row)
 * passes `floating`: the panel then sits on the body, fixed to the window, and
 * closes when the window resizes. Never inside a modal dialog, which covers the body.
 */
export function Popover({
  trigger,
  triggerLabel,
  triggerTitle,
  triggerClassName,
  disabled,
  placement = "below",
  align = "start",
  floating = false,
  panelRole,
  panelClassName = "",
  openRequest,
  children,
}: {
  /** What the trigger shows; it is told whether the panel is open. */
  trigger: (open: boolean) => ReactNode;
  /** The trigger's accessible name, when what it shows does not say it. */
  triggerLabel?: string;
  triggerTitle?: string;
  triggerClassName: string;
  disabled?: boolean;
  placement?: "below" | "above";
  align?: "start" | "end";
  floating?: boolean;
  /** `menu` when the panel holds only menu items. */
  panelRole?: "menu";
  /** The panel's size: width, height limit. */
  panelClassName?: string;
  /** Opens the panel whenever this changes to a new number (e.g. from a /command). */
  openRequest?: number;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, root, panel);

  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      position: "fixed",
      ...(placement === "above"
        ? { bottom: Math.max(window.innerHeight - rect.top + GAP, GAP) }
        : { top: rect.bottom + GAP }),
      ...(align === "end"
        ? { right: Math.max(window.innerWidth - rect.right, GAP) }
        : { left: Math.max(rect.left, GAP) }),
    });
  }, [open, floating, placement, align]);
  useEffect(() => {
    if (!open || !floating) return;
    // A fixed panel would drift from its trigger; close it when the layout moves.
    const onResize = () => setOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, floating]);

  const surface = `z-50 rounded-xl border border-outline-variant/20 bg-surface-container-high p-2 shadow-xl ${panelClassName}`;
  const anchored = `absolute ${placement === "above" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} ${align === "end" ? "right-0" : "left-0"}`;
  const content = (
    <div
      ref={panel}
      id={panelId}
      role={panelRole}
      style={floating ? position : undefined}
      className={floating ? surface : `${anchored} ${surface}`}
    >
      {typeof children === "function" ? children(close) : children}
    </div>
  );
  return (
    <div ref={root} className="relative inline-flex min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup={panelRole}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={triggerLabel}
        title={triggerTitle}
        className={triggerClassName}
      >
        {trigger(open)}
      </button>
      {open ? (floating ? createPortal(content, document.body) : content) : null}
    </div>
  );
}

/**
 * One item of a menu. With `selected` it is a choice among others (the chosen
 * one tinted and checked); without, an action.
 */
export function MenuOption({
  label,
  description,
  icon,
  selected,
  disabled,
  dense = false,
  title,
  onSelect,
}: {
  label: ReactNode;
  description?: string;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Smaller type, for a compact surface like the composer. */
  dense?: boolean;
  title?: string;
  onSelect: () => void;
}) {
  const choice = selected !== undefined;
  return (
    <button
      type="button"
      role={choice ? "menuitemradio" : "menuitem"}
      aria-checked={choice ? selected : undefined}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-40 ${
        dense ? "text-xs" : "text-sm"
      } ${selected ? "bg-primary/10 font-semibold text-primary" : "text-on-surface hover:bg-surface-container-low"}`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description ? (
          <span className="block text-[11px] font-normal text-on-surface-variant">
            {description}
          </span>
        ) : null}
      </span>
      {selected ? <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0" /> : null}
    </button>
  );
}

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
 * A dropdown to pick one value: sort order, search mode, model. Several
 * sections may share one menu (thinking mode + effort level).
 */
export function ChoiceMenu({
  sections,
  dense = false,
  ...popover
}: {
  sections: MenuSection[];
  dense?: boolean;
} & Omit<Parameters<typeof Popover>[0], "children" | "panelRole">) {
  return (
    <Popover {...popover} panelRole="menu">
      {(close) =>
        sections.map((section, index) => (
          <fieldset
            key={section.title ?? index}
            aria-label={section.title}
            className={`m-0 min-w-0 border-0 p-0 ${
              index > 0 ? "mt-1 border-t border-outline-variant/20 pt-1" : ""
            }`}
          >
            {section.title ? (
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
                {section.title}
              </div>
            ) : null}
            {section.items.map((item) => (
              <MenuOption
                key={item.id}
                label={item.label}
                description={item.description}
                icon={item.icon}
                disabled={item.disabled}
                dense={dense}
                selected={item.id === section.selected}
                onSelect={() => {
                  section.onSelect(item.id);
                  close();
                }}
              />
            ))}
          </fieldset>
        ))
      }
    </Popover>
  );
}
