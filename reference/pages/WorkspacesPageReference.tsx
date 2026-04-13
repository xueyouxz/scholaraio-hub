import type React from "react";
import WorkspacesHeaderSection from "../sections/WorkspacesHeaderSection";
import WorkspacesListSection from "../sections/WorkspacesListSection";

const WorkspacesPageReference: React.FC = () => (
  <div className="flex-1 p-8 overflow-y-auto no-scrollbar">
    <div className="max-w-5xl mx-auto space-y-6">
      <WorkspacesHeaderSection />
      <WorkspacesListSection />
    </div>
  </div>
);

export default WorkspacesPageReference;
