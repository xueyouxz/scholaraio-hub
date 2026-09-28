import { Archive, GitBranch, Pencil } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface SessionMenuActions {
  onRename(): void;
  onFork(): void;
  /** Leave it out of the lists; the provider's own files stay. */
  onArchive(): void;
  /** A running session cannot be forked until its turn ends. */
  forkDisabled?: boolean;
}

/**
 * What a right click on a sidebar session offers. It opens at the pointer,
 * stays inside the window, and closes on Escape, a click elsewhere or a scroll.
 */
export function SessionContextMenu({
  x,
  y,
  onClose,
  onRename,
  onFork,
  onArchive,
  forkDisabled = false,
}: { x: number; y: number; onClose(): void } & SessionMenuActions) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [onClose]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };
  const item = (
    label: string,
    icon: ReactNode,
    action: () => void,
    danger = false,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClose();
        action();
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${danger ? "text-error hover:bg-error/10 focus-visible:bg-error/10" : "text-on-surface hover:bg-surface-container focus-visible:bg-surface-container"} focus-visible:outline-none`}
    >
      {icon}
      {label}
    </button>
  );
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="会话操作"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-[60] min-w-[9rem] rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-1 shadow-lg"
      style={position}
    >
      {item("重命名", <Pencil size={13} aria-hidden="true" />, onRename)}
      {item("分叉", <GitBranch size={13} aria-hidden="true" />, onFork, false, forkDisabled)}
      {item("归档", <Archive size={13} aria-hidden="true" />, onArchive)}
    </div>,
    document.body,
  );
}
