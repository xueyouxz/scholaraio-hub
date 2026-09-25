import type { LiteratureProject } from "@scholaraio-hub/shared";
import { Check, ChevronDown, FolderOpen, FolderX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Which workspace a new chat starts in, changeable before the first message.
 *
 * The workspace decides the agent's directory and the papers it may cite, so
 * it is chosen here rather than fixed by whichever link opened the page.
 */
export function WorkspaceSwitcher({
  projects,
  current,
  disabled,
  onChange,
}: {
  projects: LiteratureProject[];
  current?: LiteratureProject;
  disabled: boolean;
  onChange: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  const choose = (id: string) => {
    setOpen(false);
    if (id !== (current?.id ?? "")) onChange(id);
  };
  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        aria-label={`Workspace：${current?.name ?? "未选择"}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          current
            ? "border-primary/20 bg-primary/5 text-primary"
            : "border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface"
        }`}
      >
        <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{current?.name ?? "选择 Workspace"}</span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-30 w-64 rounded-xl border border-outline-variant/20 bg-surface-container-high p-1.5 shadow-xl">
          <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            切换 Workspace
          </p>
          <div className="max-h-64 overflow-auto">
            <MenuItem active={!current} onClick={() => choose("")} icon={FolderX}>
              不关联 Workspace
            </MenuItem>
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                active={current?.id === project.id}
                onClick={() => choose(project.id)}
                icon={FolderOpen}
                meta={`${project.paperCount} 篇`}
              >
                {project.name}
              </MenuItem>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  icon: Icon,
  meta,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FolderOpen;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "text-on-surface hover:bg-surface-container-low"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta ? (
        <span className="shrink-0 text-[10px] font-mono text-on-surface-variant">{meta}</span>
      ) : null}
      {active ? <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}
