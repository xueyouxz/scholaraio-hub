import { ChevronDown, FolderKanban } from "lucide-react";
import type React from "react";
import type { WorkspaceReference } from "../types/ui";

interface WorkspaceCardProps {
  workspace: WorkspaceReference;
  expanded?: boolean;
}

const WorkspaceCard: React.FC<WorkspaceCardProps> = ({ workspace, expanded = false }) => (
  <article className="rounded-2xl border border-outline-variant/20 bg-surface-container-low">
    <div className="w-full px-5 py-4 flex items-center justify-between text-left">
      <div className="flex items-center gap-3">
        <FolderKanban className="w-5 h-5 text-primary" />
        <div>
          <p className="font-semibold text-on-surface">{workspace.name}</p>
          <p className="text-xs text-on-surface-variant">
            {workspace.paperCount} papers · {workspace.createdAt}
          </p>
        </div>
      </div>
      <ChevronDown className={`w-4 h-4 text-on-surface-variant ${expanded ? "rotate-180" : ""}`} />
    </div>
    {expanded ? (
      <div className="px-5 pb-5 border-t border-outline-variant/15 pt-4 space-y-2">
        {workspace.papers.map((paper) => (
          <div key={paper.id} className="block rounded-xl bg-surface-container-high px-3 py-2">
            <p className="text-sm font-medium text-on-surface">{paper.title}</p>
            <p className="text-xs text-on-surface-variant mt-1">{paper.authors}</p>
          </div>
        ))}
      </div>
    ) : null}
  </article>
);

export default WorkspaceCard;
