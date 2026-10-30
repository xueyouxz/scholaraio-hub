import type { ProjectSummary } from "@scholaraio-hub/shared";
import { Check, ChevronDown, FolderOpen, FolderPlus, FolderX } from "lucide-react";
import { useRef, useState } from "react";
import { useDismiss } from "../../../shared/ui/useDismiss";

/**
 * Which project a new chat runs in, changeable before the first message: one
 * of the projects the agents have sessions in, another folder chosen in the
 * system's dialog (as Claude Code does), or none (the session then gets a
 * folder of its own).
 */
export function ProjectPicker({
  projects,
  current,
  disabled,
  onChange,
  onAdd,
  adding,
}: {
  projects: ProjectSummary[];
  current?: ProjectSummary;
  disabled: boolean;
  onChange: (projectId: string) => void;
  /** Choose another folder in the system's dialog; the new project becomes the choice. */
  onAdd: () => void;
  /** The dialog is open. */
  adding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), menu);
  const choose = (id: string) => {
    setOpen(false);
    if (id !== (current?.id ?? "")) onChange(id);
  };
  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        aria-label={adding ? "正在选择文件夹" : `项目：${current?.name ?? "不使用项目"}`}
        aria-expanded={open}
        disabled={disabled || adding}
        title={current?.path}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          current
            ? "border-primary/20 bg-primary/5 text-primary"
            : "border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface"
        }`}
      >
        <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {adding ? "在弹出的窗口中选择文件夹…" : (current?.name ?? "选择项目")}
        </span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-30 w-72 rounded-xl border border-outline-variant/20 bg-surface-container-high p-1.5 shadow-xl">
          <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            在哪个项目中运行
          </p>
          <div className="max-h-64 overflow-auto">
            <MenuItem active={!current} onClick={() => choose("")} icon={FolderX}>
              不使用项目（临时目录）
            </MenuItem>
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                active={current?.id === project.id}
                onClick={() => choose(project.id)}
                icon={FolderOpen}
                title={project.path}
              >
                {project.name}
              </MenuItem>
            ))}
          </div>
          <div className="mt-1 border-t border-outline-variant/15 pt-1">
            <MenuItem
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
              icon={FolderPlus}
            >
              选择其他文件夹…
            </MenuItem>
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
  title,
  children,
}: {
  /** Which choice is the current one; unset for an action. */
  active?: boolean;
  onClick: () => void;
  icon: typeof FolderOpen;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "text-on-surface hover:bg-surface-container-low"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active ? <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}
