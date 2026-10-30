import type { SessionDetail } from "@scholaraio-hub/shared";
import { BookOpen, FolderTree } from "lucide-react";
import { Badge } from "../../../shared/ui/Badge";

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
  references,
  onTogglePanel,
}: {
  title: string;
  provider: SessionDetail["provider"];
  model?: string;
  state: SessionDetail["state"];
  running: boolean;
  /** Leave room for the navigation button overlaid on narrow screens. */
  inset: boolean;
  panel?: SessionPanel;
  /** How many references the session answers from, shown on the references button. */
  references: number;
  onTogglePanel: (panel: SessionPanel) => void;
}) {
  const label = state === "waiting-input" ? "needs input" : running ? "running" : "idle";
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
        <Badge tone={label === "idle" ? "neutral" : "attention"}>{label}</Badge>
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
        <button
          type="button"
          aria-label="引用的文献"
          title={references ? `引用的文献（${references}）` : "引用的文献"}
          aria-pressed={panel === "papers"}
          onClick={() => onTogglePanel("papers")}
          className={`${panelButton(panel === "papers")} relative`}
        >
          <BookOpen size={15} />
          {references ? (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-on-primary text-[9px] font-mono leading-[14px] text-center">
              {references}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
}
