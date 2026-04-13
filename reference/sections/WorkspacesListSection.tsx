import type React from "react";
import WorkspaceCard from "../components/WorkspaceCard";
import { workspaces } from "../mock/workspaces";

const WorkspacesListSection: React.FC = () => (
  <section className="space-y-4">
    {workspaces.map((workspace, index) => (
      <WorkspaceCard key={workspace.id} workspace={workspace} expanded={index === 0} />
    ))}
  </section>
);

export default WorkspacesListSection;
