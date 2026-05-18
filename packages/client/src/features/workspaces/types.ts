import type { PaperReference } from "../library/types";

export interface WorkspaceReference {
  id: string;
  name: string;
  createdAt: string;
  paperCount: number;
  papers: PaperReference[];
}
