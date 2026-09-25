import type { StoredSession } from "@scholaraio-hub/shared";
import { BookOpen, FolderTree } from "lucide-react";

export type SessionPanel = "files" | "papers";

/** Title bar of an open session: what runs it, whether it runs, and the side panels. */
export function SessionHeader({
  title,
  provider,
  model,
  state,
  running,
  inset,
  panel,
  hasPapers,
  onTogglePanel,
}: {
  title: string;
  provider: StoredSession["provider"];
  model?: string;
  state: StoredSession["state"];
  running: boolean;
  /** Leave room for the navigation button overlaid on narrow screens. */
  inset: boolean;
  panel?: SessionPanel;
  hasPapers: boolean;
  onTogglePanel: (panel: SessionPanel) => void;
}) {
  const label = state === "waiting-input" ? "needs input" : running ? "running" : "idle";
  const pill =
    label === "idle"
      ? "bg-surface-container text-on-surface-variant"
      : "bg-tertiary-container/30 text-tertiary";
  const panelButton = (active: boolean) =>
    `p-1 rounded transition-colors ${active ? "text-primary bg-primary/10" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"}`;
  return (
    <header
      className={`shrink-0 flex items-center justify-between h-[3.25rem] px-4 ${inset ? "pl-16" : ""} border-b border-outline-variant/10 bg-surface z-10`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <h1 className="font-sans text-sm font-medium text-on-surface truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden sm:inline text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
          {provider}
          {model ? ` · ${model}` : ""}
        </span>
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${pill}`}>
          {label}
        </span>
        <button
          type="button"
          aria-label="会话文件"
          title="会话文件"
          aria-pressed={panel === "files"}
          onClick={() => onTogglePanel("files")}
          className={panelButton(panel === "files")}
        >
          <FolderTree size={15} />
        </button>
        {hasPapers ? (
          <button
            type="button"
            aria-label="项目文献"
            title="项目文献"
            aria-pressed={panel === "papers"}
            onClick={() => onTogglePanel("papers")}
            className={panelButton(panel === "papers")}
          >
            <BookOpen size={15} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
