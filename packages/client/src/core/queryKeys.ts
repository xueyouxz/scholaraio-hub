import type { ScholarPaperContentParams, ScholarPaperListParams, ScholarSearchBody } from "./api";

export const queryKeys = {
  projects: () => ["projects"] as const,
  providers: () => ["providers"] as const,
  settings: () => ["settings"] as const,
  version: () => ["version"] as const,
  scholar: {
    all: () => ["scholar"] as const,
    papers: (params: ScholarPaperListParams = {}) => ["scholar", "papers", params] as const,
    paper: (id: string) => ["scholar", "paper", id] as const,
    paperContent: (id: string, params: ScholarPaperContentParams) =>
      ["scholar", "paper", id, "content", params] as const,
    stats: () => ["scholar", "stats"] as const,
    search: (body: ScholarSearchBody) => ["scholar", "search", body] as const,
    workspaces: () => ["scholar", "workspaces"] as const,
    workspace: (name: string) => ["scholar", "workspace", name] as const,
    config: () => ["scholar", "config"] as const,
  },
};
