import type { ProjectSummary } from "@scholaraio-hub/shared";
import { ChevronDown, FolderOpen, FolderPlus, FolderX } from "lucide-react";
import { MenuOption, Popover } from "../../../shared/ui/Menu";

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
  return (
    <Popover
      disabled={disabled || adding}
      placement="above"
      panelRole="menu"
      panelClassName="w-72"
      triggerLabel={adding ? "正在选择文件夹" : `项目：${current?.name ?? "不使用项目"}`}
      triggerTitle={current?.path}
      triggerClassName={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        current
          ? "border-primary/20 bg-primary/5 text-primary"
          : "border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface"
      }`}
      trigger={(open) => (
        <>
          <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {adding ? "在弹出的窗口中选择文件夹…" : (current?.name ?? "选择项目")}
          </span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </>
      )}
    >
      {(close) => {
        const choose = (id: string) => {
          close();
          if (id !== (current?.id ?? "")) onChange(id);
        };
        const icon = (Icon: typeof FolderOpen) => (
          <Icon className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        );
        return (
          <>
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
              在哪个项目中运行
            </p>
            <div className="max-h-64 overflow-auto">
              <MenuOption
                label="不使用项目（临时目录）"
                icon={icon(FolderX)}
                selected={!current}
                onSelect={() => choose("")}
              />
              {projects.map((project) => (
                <MenuOption
                  key={project.id}
                  label={project.name}
                  icon={icon(FolderOpen)}
                  title={project.path}
                  selected={current?.id === project.id}
                  onSelect={() => choose(project.id)}
                />
              ))}
            </div>
            <div className="mt-1 border-t border-outline-variant/15 pt-1">
              <MenuOption
                label="选择其他文件夹…"
                icon={icon(FolderPlus)}
                onSelect={() => {
                  close();
                  onAdd();
                }}
              />
            </div>
          </>
        );
      }}
    </Popover>
  );
}
