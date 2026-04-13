import type React from "react";
import { readerWorkspaces } from "../mock/reader";

const ReaderWorkspaceModalSection: React.FC = () => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center">
    <div className="absolute inset-0 bg-on-surface/25 backdrop-blur-sm" />
    <div className="relative z-10 w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
      <h4 className="font-serif text-2xl font-bold mb-2">选择工作区</h4>
      <p className="text-sm text-on-surface-variant mb-4">将 2 篇已选择论文加入目标工作区。</p>

      <div className="space-y-2 max-h-64 overflow-y-auto no-scrollbar">
        {readerWorkspaces.map((workspace) => (
          <div
            key={workspace.id}
            className="w-full text-left rounded-xl bg-surface-container p-3 hover:bg-surface-container-high transition-colors"
          >
            <p className="text-sm font-semibold">{workspace.name}</p>
            <p className="text-xs text-on-surface-variant mt-1">{workspace.paperCount} papers</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ReaderWorkspaceModalSection;
