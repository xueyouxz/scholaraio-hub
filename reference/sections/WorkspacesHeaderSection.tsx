import { Plus } from "lucide-react";
import type React from "react";

const WorkspacesHeaderSection: React.FC = () => (
  <>
    <header className="flex items-center justify-between">
      <div>
        <h2 className="font-serif text-4xl font-bold text-on-surface">Workspaces</h2>
        <p className="text-on-surface-variant mt-2">将相关论文组织成可复用的研究工作区。</p>
      </div>
      <button className="px-4 py-2 rounded-xl bg-primary/10 text-primary font-semibold text-sm flex items-center gap-2">
        <Plus className="w-4 h-4" />
        New Workspace
      </button>
    </header>

    <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 flex gap-3">
      <div className="flex-1 rounded-xl bg-surface-container-high px-3 py-2 text-sm text-on-surface-variant">
        新建文献主题工作区
      </div>
      <button className="px-4 py-2 rounded-xl signature-gradient text-on-primary text-sm font-semibold">
        Create
      </button>
    </div>
  </>
);

export default WorkspacesHeaderSection;
